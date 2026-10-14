import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Insertable, Kysely } from 'kysely';
import { AppModule } from '../../src/app.module.js';
import { addDays } from '../../src/availability/time-zone.js';
import { ProofRetentionService } from '../../src/bookings/proof-retention.service.js';
import type { DB } from '../../src/database/database.types.js';
import {
  FILE_STORAGE,
  newStorageKey,
  type FileStorage,
} from '../../src/storage/file-storage.js';
import { LocalFileStorage } from '../../src/storage/local-file-storage.js';
import { seedAdmin } from '../../src/auth/seed-admin.js';
import { createTestDatabase } from '../helpers/database.js';
import { localAt, upcoming } from '../helpers/dates.js';

// The daily job that deletes proof files 90 days after a booking reaches a
// final status, and files nobody has a record of (BR-14, #77).

const PREFIX = 'Retention test ';
const DAY = 86_400_000;
const sha256 = (data: string | Buffer) =>
  createHash('sha256').update(data).digest();

describe('Proof retention job', () => {
  let db: Kysely<DB>;
  let app: INestApplication;
  let storage: LocalFileStorage;
  let uploadDir: string;
  let retention: ProofRetentionService;
  let adminId: string;
  let service: { id: string };
  let counter = 0;

  beforeAll(async () => {
    db = createTestDatabase();
    uploadDir = await mkdtemp(join(tmpdir(), 'mbg-retention-'));
    storage = new LocalFileStorage(uploadDir);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FILE_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    retention = app.get(ProofRetentionService);
    // Confirmed bookings need a confirming admin on record (a database rule)
    adminId = (
      await db.transaction().execute((trx) =>
        seedAdmin(trx, {
          email: 'retention@example.com',
          password: 'test-admin-password',
        }),
      )
    ).id;
    service = await db
      .insertInto('services')
      .values({
        name: `${PREFIX}Soft Glam`,
        price: '650.00',
        duration_minutes: 90,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  });

  afterEach(async () => {
    await clean(db, service.id);
    for (const key of await storage.list('private')) {
      await storage.delete('private', key);
    }
  });

  afterAll(async () => {
    await clean(db, service.id);
    await db
      .deleteFrom('services')
      .where('name', 'like', `${PREFIX}%`)
      .execute();
    await db.deleteFrom('users').where('id', '=', adminId).execute();
    await app.close();
    await db.destroy();
    await rm(uploadDir, { recursive: true, force: true });
  });

  // A booking that reached `status` at `reachedAt`, with one proof file
  async function bookingWithProof(
    status:
      | 'pending'
      | 'confirmed'
      | 'completed'
      | 'no_show'
      | 'cancelled'
      | 'expired',
    reachedAt: Date,
  ) {
    counter += 1;
    const start = localAt(addDays(upcoming(2), counter * 7), '09:00');
    const extra: Partial<Insertable<DB['bookings']>> = {};
    if (status === 'confirmed' || status === 'completed') {
      extra.amount_received = '325.00';
      extra.payment_verified_at = new Date();
      extra.payment_verified_by = adminId;
    }
    if (status === 'cancelled') {
      extra.cancelled_at = reachedAt;
      extra.cancelled_by = 'client';
    }
    const booking = await db
      .insertInto('bookings')
      .values({
        service_id: service.id,
        client_name: `Client ${counter}`,
        client_email: `client${counter}.retention@example.com`,
        client_phone: `+2782558${String(1000 + counter)}`,
        start_at: start,
        end_at: new Date(start.getTime() + 90 * 60_000),
        occupied_until: new Date(start.getTime() + 150 * 60_000),
        price_at_booking: '650.00',
        deposit_amount: '325.00',
        deposit_due_at:
          status === 'pending' ? new Date(Date.now() + DAY) : null,
        status,
        ...extra,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // The status change is the last change: put it where the test wants it
    await db
      .updateTable('bookings')
      .set({ updated_at: reachedAt })
      .where('id', '=', booking.id)
      .execute();
    const key = newStorageKey();
    await storage.save('private', key, Buffer.from('%PDF-1.4 proof'));
    const proof = await db
      .insertInto('payment_proofs')
      .values({
        booking_id: booking.id,
        storage_key: key,
        original_filename: 'proof.pdf',
        content_type: 'application/pdf',
        size_bytes: 14,
        sha256: sha256('x'),
        uploaded_from_ip: '196.25.1.1',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { bookingId: booking.id, proofId: proof.id, key };
  }
  const proof = (id: string) =>
    db
      .selectFrom('payment_proofs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const fileExists = async (key: string) =>
    (await storage.modifiedAt('private', key)) !== null;

  const NOW = new Date('2027-03-01T12:00:00Z');
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  describe('the 90-day boundary', () => {
    it('keeps a file one minute before 90 days and deletes it at 90 days', async () => {
      const justUnder = await bookingWithProof(
        'cancelled',
        ago(90 * DAY - 60_000),
      );
      const exactly = await bookingWithProof('cancelled', ago(90 * DAY));
      const over = await bookingWithProof('cancelled', ago(91 * DAY));

      const result = await retention.run(NOW);
      expect(result).toEqual({ deleted: 2, strays: 0 });

      expect(await fileExists(justUnder.key)).toBe(true);
      expect((await proof(justUnder.proofId)).file_deleted_at).toBeNull();
      for (const old of [exactly, over]) {
        expect(await fileExists(old.key)).toBe(false);
        expect((await proof(old.proofId)).file_deleted_at).toEqual(NOW);
      }
    });

    it('applies to Completed, No-show, Cancelled and Expired bookings', async () => {
      const finished = [];
      for (const status of [
        'completed',
        'no_show',
        'cancelled',
        'expired',
      ] as const) {
        finished.push(await bookingWithProof(status, ago(120 * DAY)));
      }
      expect(await retention.run(NOW)).toEqual({ deleted: 4, strays: 0 });
      for (const item of finished) {
        expect(await fileExists(item.key)).toBe(false);
      }
    });

    it('never touches a booking that is still Pending or Confirmed, however old', async () => {
      const pending = await bookingWithProof('pending', ago(400 * DAY));
      const confirmed = await bookingWithProof('confirmed', ago(400 * DAY));
      expect(await retention.run(NOW)).toEqual({ deleted: 0, strays: 0 });
      for (const item of [pending, confirmed]) {
        expect(await fileExists(item.key)).toBe(true);
        expect((await proof(item.proofId)).file_deleted_at).toBeNull();
      }
    });

    it('counts a cancelled booking from when it was cancelled, not from later changes', async () => {
      // Cancelled 10 days ago, but its record was touched 200 days... later
      // changes (for example recording a refund) must not restart the clock
      const item = await bookingWithProof('cancelled', ago(100 * DAY));
      await db
        .updateTable('bookings')
        .set({ updated_at: ago(1 * DAY) })
        .where('id', '=', item.bookingId)
        .execute();
      expect(await retention.run(NOW)).toEqual({ deleted: 1, strays: 0 });
      expect(await fileExists(item.key)).toBe(false);
    });
  });

  describe('what it keeps and what it does', () => {
    it('keeps the proof record, with its hash, status and times', async () => {
      const item = await bookingWithProof('expired', ago(200 * DAY));
      const before = await proof(item.proofId);
      await retention.run(NOW);
      const after = await proof(item.proofId);
      expect(after).toMatchObject({
        id: before.id,
        booking_id: before.booking_id,
        original_filename: 'proof.pdf',
        status: 'received',
        size_bytes: 14,
      });
      expect(after.sha256).toEqual(before.sha256);
      expect(after.uploaded_at).toEqual(before.uploaded_at);
      expect(after.file_deleted_at).not.toBeNull();
    });

    it('does nothing a second time', async () => {
      await bookingWithProof('cancelled', ago(200 * DAY));
      expect((await retention.run(NOW)).deleted).toBe(1);
      expect(await retention.run(NOW)).toEqual({ deleted: 0, strays: 0 });
    });

    it('leaves a proof whose file was already deleted alone', async () => {
      const item = await bookingWithProof('cancelled', ago(200 * DAY));
      const earlier = ago(50 * DAY);
      await db
        .updateTable('payment_proofs')
        .set({ file_deleted_at: earlier })
        .where('id', '=', item.proofId)
        .execute();
      await retention.run(NOW);
      expect((await proof(item.proofId)).file_deleted_at).toEqual(earlier);
    });

    it('carries on, and tries again next time, when one file cannot be deleted', async () => {
      const stuck = await bookingWithProof('cancelled', ago(200 * DAY));
      const fine = await bookingWithProof('cancelled', ago(200 * DAY));
      const original = storage.delete.bind(storage);
      const failing = {
        ...storage,
        list: storage.list.bind(storage),
        modifiedAt: storage.modifiedAt.bind(storage),
        read: storage.read.bind(storage),
        save: storage.save.bind(storage),
        delete: (area: 'private' | 'public', key: string) =>
          key === stuck.key
            ? Promise.reject(new Error('disk error'))
            : original(area, key),
      } satisfies FileStorage;
      const service = new ProofRetentionService(db, failing, {
        get: () => 'test',
      } as never);
      expect(await service.run(NOW)).toEqual({ deleted: 1, strays: 0 });
      expect((await proof(stuck.proofId)).file_deleted_at).toBeNull();
      expect(await fileExists(stuck.key)).toBe(true);
      expect((await proof(fine.proofId)).file_deleted_at).not.toBeNull();
      // Tomorrow it works
      expect(await retention.run(NOW)).toEqual({ deleted: 1, strays: 0 });
    });
  });

  describe('stray files', () => {
    const makeStray = async (age: number) => {
      const key = newStorageKey();
      await storage.save('private', key, Buffer.from('orphan'));
      const when = new Date(NOW.getTime() - age);
      await utimes(join(uploadDir, 'private', key), when, when);
      return key;
    };

    it('removes a file with no proof record once it is over an hour old', async () => {
      const old = await makeStray(2 * 3_600_000);
      expect(await retention.run(NOW)).toEqual({ deleted: 0, strays: 1 });
      expect(await fileExists(old)).toBe(false);
    });

    it('leaves a recent one alone: an upload may still be recording it', async () => {
      const fresh = await makeStray(5 * 60_000);
      expect(await retention.run(NOW)).toEqual({ deleted: 0, strays: 0 });
      expect(await fileExists(fresh)).toBe(true);
    });

    it('never removes a file that has a proof record', async () => {
      const item = await bookingWithProof('pending', ago(1 * DAY));
      const when = new Date(NOW.getTime() - 30 * DAY);
      await utimes(join(uploadDir, 'private', item.key), when, when);
      expect(await retention.run(NOW)).toEqual({ deleted: 0, strays: 0 });
      expect(await fileExists(item.key)).toBe(true);
    });

    it('leaves the public area alone', async () => {
      const key = newStorageKey();
      await storage.save('public', key, Buffer.from('photo'));
      const when = new Date(NOW.getTime() - 30 * DAY);
      await utimes(join(uploadDir, 'public', key), when, when);
      await retention.run(NOW);
      expect(await storage.modifiedAt('public', key)).not.toBeNull();
      await storage.delete('public', key);
    });
  });
});

async function clean(db: Kysely<DB>, serviceId: string) {
  const mine = db
    .selectFrom('bookings')
    .select('id')
    .where('service_id', '=', serviceId);
  await db
    .deleteFrom('notifications')
    .where('booking_id', 'in', mine)
    .execute();
  await db
    .deleteFrom('payment_proofs')
    .where('booking_id', 'in', mine)
    .execute();
  await db.deleteFrom('bookings').where('service_id', '=', serviceId).execute();
}
