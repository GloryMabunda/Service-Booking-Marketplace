import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Insertable, Kysely, Selectable } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../../src/app.factory.js';
import { AppModule } from '../../src/app.module.js';
import { addDays } from '../../src/availability/time-zone.js';
import {
  RATE_LIMITER,
  type SlidingWindowLimiter,
} from '../../src/common/rate-limit.js';
import type { DB } from '../../src/database/database.types.js';
import {
  EMAIL_PROVIDER,
  type EmailMessage,
  type EmailProvider,
} from '../../src/notifications/email-provider.js';
import { FILE_STORAGE } from '../../src/storage/file-storage.js';
import { LocalFileStorage } from '../../src/storage/local-file-storage.js';
import { removeTestAdmin, signInTestAdmin, type TestAdmin } from './admin.js';
import { createTestDatabase } from './database.js';
import { localAt, upcoming } from './dates.js';

// What the security and end-to-end suites share: the whole app on the test
// database, with the email sender replaced by one that keeps what it was given
// and file storage in a temporary folder, plus a signed-in admin and a service.

export class FakeEmailProvider implements EmailProvider {
  sent: EmailMessage[] = [];
  failWith: string | null = null;
  send(message: EmailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(new Error(this.failWith));
    this.sent.push(message);
    return Promise.resolve();
  }
  to(address: string) {
    return this.sent.filter((m) => m.to === address);
  }
}

export const sha256 = (data: string | Buffer) =>
  createHash('sha256').update(data).digest();

export const BANKING = {
  accountName: 'Make Up by Glory',
  bank: 'Example Bank',
  accountNumber: '1234567890',
  branchCode: '250655',
  accountType: 'Cheque',
};

export type BookingRow = Selectable<DB['bookings']>;

export interface Harness {
  app: INestApplication<App>;
  db: Kysely<DB>;
  provider: FakeEmailProvider;
  storage: LocalFileStorage;
  uploadDir: string;
  admin: TestAdmin;
  service: { id: string };
  http: () => ReturnType<typeof request>;
  /** An admin request: sets the session cookie */
  asAdmin: (r: request.Test) => request.Test;
  /** A booking saved directly, on its own day. Returns it with its link token. */
  makeBooking: (
    overrides?: Partial<Insertable<DB['bookings']>>,
  ) => Promise<{ booking: BookingRow; token: string }>;
  getBooking: (id: string) => Promise<BookingRow>;
  /** Forgets rate limits, the emails sent and stored files */
  reset: () => Promise<void>;
  /** Removes everything the suite made, and closes the app */
  close: () => Promise<void>;
}

// `prefix` names the suite's service, so cleanup can't touch anything else
export async function startHarness(prefix: string): Promise<Harness> {
  const db = createTestDatabase();
  const provider = new FakeEmailProvider();
  const uploadDir = await mkdtemp(join(tmpdir(), 'mbg-harness-'));
  const storage = new LocalFileStorage(uploadDir);
  const original = await db
    .selectFrom('settings')
    .selectAll()
    .executeTakeFirstOrThrow();
  await db
    .updateTable('settings')
    .set({ banking_details: JSON.stringify(BANKING) })
    .where('id', '=', 1)
    .execute();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(provider)
    .overrideProvider(FILE_STORAGE)
    .useValue(storage)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  configureApp(app);
  await app.init();

  const admin = await signInTestAdmin(app, db, `${prefix}@example.com`);
  const service = await db
    .insertInto('services')
    .values({
      name: `${prefix} Soft Glam`,
      price: '650.00',
      duration_minutes: 90,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  // Each suite books on days of its own, so two suites in one run (or one left
  // half-cleaned) can never ask for the same time
  let counter = 0;
  const dayOffset = 1 + (sha256(prefix).readUInt16BE(0) % 600);
  const getBooking = (id: string) =>
    db
      .selectFrom('bookings')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const harness: Harness = {
    app,
    db,
    provider,
    storage,
    uploadDir,
    admin,
    service,
    http: () => request(app.getHttpServer()),
    asAdmin: (r) => r.set('Cookie', admin.cookie),
    getBooking,
    makeBooking: async (overrides = {}) => {
      counter += 1;
      const start = localAt(
        addDays(upcoming(2), dayOffset + counter * 7),
        '09:00',
      );
      const status = overrides.status ?? 'pending';
      const token = randomBytes(32).toString('base64url');
      const extra: Partial<Insertable<DB['bookings']>> = {};
      if (status === 'confirmed' || status === 'completed') {
        extra.amount_received = '325.00';
        extra.payment_verified_at = new Date();
        extra.payment_verified_by = admin.id;
      }
      if (status === 'cancelled') {
        extra.cancelled_at = new Date();
        extra.cancelled_by = 'client';
      }
      const row = await db
        .insertInto('bookings')
        .values({
          service_id: service.id,
          client_name: `Client ${counter}`,
          client_email: `client${counter}.${prefix}@example.com`.toLowerCase(),
          client_phone: `+2782559${String(1000 + counter)}`,
          start_at: start,
          end_at: new Date(start.getTime() + 90 * 60_000),
          occupied_until: new Date(start.getTime() + 150 * 60_000),
          price_at_booking: '650.00',
          deposit_amount: '325.00',
          deposit_due_at:
            status === 'pending' ? new Date(Date.now() + 86_400_000) : null,
          status,
          booking_token_hash: sha256(token),
          booking_token_created_at: new Date(),
          ...extra,
          ...overrides,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { booking: row, token };
    },
    reset: async () => {
      app.get<SlidingWindowLimiter>(RATE_LIMITER).reset();
      provider.sent = [];
      provider.failWith = null;
      for (const area of ['private', 'public'] as const) {
        for (const key of await storage.list(area))
          await storage.delete(area, key);
      }
    },
    close: async () => {
      const mine = db
        .selectFrom('bookings')
        .select('id')
        .where('service_id', '=', service.id);
      await db
        .deleteFrom('notifications')
        .where('booking_id', 'in', mine)
        .execute();
      await db
        .deleteFrom('payment_proofs')
        .where('booking_id', 'in', mine)
        .execute();
      await db
        .deleteFrom('bookings')
        .where('service_id', '=', service.id)
        .execute();
      await db.deleteFrom('gallery_items').execute();
      await db.deleteFrom('images').execute();
      await db.deleteFrom('services').where('id', '=', service.id).execute();
      await db
        .updateTable('settings')
        .set({
          ...original,
          banking_details: JSON.stringify(original.banking_details),
        })
        .where('id', '=', 1)
        .execute();
      await removeTestAdmin(db, admin);
      await app.close();
      await db.destroy();
      await rm(uploadDir, { recursive: true, force: true });
    },
  };
  return harness;
}

// The booking link inside an email: its token, or null if there is none
export function linkTokenIn(text: string): string | null {
  return /http\S*\/booking\/([\w-]{43})/.exec(text)?.[1] ?? null;
}
