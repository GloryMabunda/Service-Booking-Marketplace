import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Insertable, Kysely } from 'kysely';
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
import { FILE_STORAGE, newStorageKey } from '../../src/storage/file-storage.js';
import { LocalFileStorage } from '../../src/storage/local-file-storage.js';
import {
  removeTestAdmin,
  signInTestAdmin,
  type TestAdmin,
} from '../helpers/admin.js';
import { createTestDatabase } from '../helpers/database.js';
import { localAt, upcoming } from '../helpers/dates.js';
import { bodyOf, errorBody } from '../helpers/http.js';

// Proof files, proof review and the calendar in the admin portal (#72, #76;
// docs/api.md 7.9, 7.10 and 7.11).

class FakeEmailProvider implements EmailProvider {
  sent: EmailMessage[] = [];
  failWith: string | null = null;
  send(message: EmailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(new Error(this.failWith));
    this.sent.push(message);
    return Promise.resolve();
  }
}

const PREFIX = 'Admin proofs test ';
const sha256 = (data: string | Buffer) =>
  createHash('sha256').update(data).digest();
const PDF = Buffer.from('%PDF-1.4\n%proof\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

interface ProofJson {
  id: string;
  status: string;
  rejectionReason: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

describe('Admin proofs and calendar API', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let admin: TestAdmin;
  let provider: FakeEmailProvider;
  let storage: LocalFileStorage;
  let uploadDir: string;
  let service: { id: string };
  let counter = 0;

  beforeAll(async () => {
    db = createTestDatabase();
    provider = new FakeEmailProvider();
    uploadDir = await mkdtemp(join(tmpdir(), 'mbg-admin-proofs-'));
    storage = new LocalFileStorage(uploadDir);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(provider)
      .overrideProvider(FILE_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    admin = await signInTestAdmin(app, db, 'admin-proofs@example.com');
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

  beforeEach(() => {
    app.get<SlidingWindowLimiter>(RATE_LIMITER).reset();
    provider.sent = [];
    provider.failWith = null;
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
      .deleteFrom('blocked_times')
      .where('reason', 'like', `${PREFIX}%`)
      .execute();
    await db
      .deleteFrom('services')
      .where('name', 'like', `${PREFIX}%`)
      .execute();
    await removeTestAdmin(db, admin);
    await app.close();
    await db.destroy();
    await rm(uploadDir, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());
  const get = (path: string, cookie = admin.cookie) =>
    http().get(`/api/admin${path}`).set('Cookie', cookie);
  const patch = (path: string, body: object) =>
    http().patch(`/api/admin${path}`).set('Cookie', admin.cookie).send(body);

  async function insertBooking(
    overrides: Partial<Insertable<DB['bookings']>> = {},
  ) {
    counter += 1;
    const start = localAt(addDays(upcoming(2), counter * 7), '09:00');
    const status = overrides.status ?? 'pending';
    const confirmed =
      status === 'confirmed'
        ? {
            amount_received: '325.00',
            payment_verified_at: new Date(),
            payment_verified_by: admin.id,
          }
        : {};
    const cancelled =
      status === 'cancelled'
        ? { cancelled_at: new Date(), cancelled_by: 'admin' as const }
        : {};
    return db
      .insertInto('bookings')
      .values({
        service_id: service.id,
        client_name: `Client ${counter}`,
        client_email: `client${counter}.proofs-test@example.com`,
        client_phone: `+2782557${String(1000 + counter)}`,
        start_at: start,
        end_at: new Date(start.getTime() + 90 * 60_000),
        occupied_until: new Date(start.getTime() + 150 * 60_000),
        price_at_booking: '650.00',
        deposit_amount: '325.00',
        deposit_due_at:
          status === 'pending' ? new Date(Date.now() + 86_400_000) : null,
        status,
        booking_token_hash: sha256(randomBytes(32)),
        booking_token_created_at: new Date(),
        ...confirmed,
        ...cancelled,
        ...overrides,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // A proof with its file really in storage
  async function insertProof(
    bookingId: string,
    options: {
      data?: Buffer;
      contentType?: string;
      filename?: string;
      uploadedAt?: Date;
    } = {},
  ) {
    const data = options.data ?? PDF;
    const key = newStorageKey();
    await storage.save('private', key, data);
    return db
      .insertInto('payment_proofs')
      .values({
        booking_id: bookingId,
        storage_key: key,
        original_filename: options.filename ?? 'proof.pdf',
        content_type: options.contentType ?? 'application/pdf',
        size_bytes: data.length,
        sha256: sha256(data),
        uploaded_from_ip: '196.25.1.1',
        ...(options.uploadedAt ? { uploaded_at: options.uploadedAt } : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  const proofRow = (id: string) =>
    db
      .selectFrom('payment_proofs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const bookingRow = (id: string) =>
    db
      .selectFrom('bookings')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const proofOf = (res: request.Response) =>
    bodyOf<{ proof: ProofJson; emailSentTo?: string | null }>(res);
  const toClient = (email: string) =>
    provider.sent.filter((m) => m.to === email);

  describe('who may use it', () => {
    it.each([
      [
        'GET',
        '/api/admin/payment-proofs/00000000-0000-0000-0000-000000000000/file',
      ],
      [
        'PATCH',
        '/api/admin/payment-proofs/00000000-0000-0000-0000-000000000000',
      ],
      ['GET', '/api/admin/calendar?from=2026-11-01&to=2026-11-30'],
    ])('%s %s needs a signed-in admin', async (method, path) => {
      const res = await http()[method.toLowerCase() as 'get'](path);
      expect(res.status).toBe(401);
    });

    it('never serves a proof file to a signed-out visitor', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      const res = await http().get(
        `/api/admin/payment-proofs/${proof.id}/file`,
      );
      expect(res.status).toBe(401);
      expect(res.body).not.toBeInstanceOf(Buffer);
      expect(JSON.stringify(res.body)).not.toContain('%PDF');
      // Nor is it reachable as a static file under any guessable path
      for (const path of [
        `/uploads/private/${proof.storage_key}`,
        `/private/${proof.storage_key}`,
        `/${proof.storage_key}`,
      ]) {
        expect((await http().get(path)).status).toBe(404);
      }
    });
  });

  describe('the proof file (#72)', () => {
    it('is shown inline with the safe headers', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      const res = await get(`/payment-proofs/${proof.id}/file`).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `inline; filename="${booking.reference}-proof-1.pdf"`,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-length']).toBe(String(PDF.length));
      expect(Buffer.from(res.body as Buffer)).toEqual(PDF);
    });

    it('is downloaded with ?download=true', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      const res = await get(`/payment-proofs/${proof.id}/file?download=true`);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="${booking.reference}-proof-1.pdf"`,
      );
    });

    it('numbers a booking’s proofs in upload order and uses the right extension', async () => {
      const booking = await insertBooking();
      const first = await insertProof(booking.id, {
        uploadedAt: new Date(Date.now() - 60_000),
      });
      const second = await insertProof(booking.id, {
        data: PNG,
        contentType: 'image/png',
        filename: 'screenshot.png',
      });
      const a = await get(`/payment-proofs/${first.id}/file`);
      const b = await get(`/payment-proofs/${second.id}/file`);
      expect(a.headers['content-disposition']).toContain(
        `${booking.reference}-proof-1.pdf`,
      );
      expect(b.headers['content-disposition']).toContain(
        `${booking.reference}-proof-2.png`,
      );
      expect(b.headers['content-type']).toBe('image/png');
    });

    it('never uses the uploaded filename in a header', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id, {
        filename: "evil\"; filename*=UTF-8''x.exe\r\nSet-Cookie: a=b.pdf",
      });
      const res = await get(`/payment-proofs/${proof.id}/file`);
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toBe(
        `inline; filename="${booking.reference}-proof-1.pdf"`,
      );
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('answers 410 FILE_DELETED once the file was removed', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      await db
        .updateTable('payment_proofs')
        .set({ file_deleted_at: new Date() })
        .where('id', '=', proof.id)
        .execute();
      const res = await get(`/payment-proofs/${proof.id}/file`);
      expect(res.status).toBe(410);
      expect(errorBody(res).code).toBe('FILE_DELETED');

      // and when the file has gone from disk without the record saying so
      const other = await insertProof(booking.id);
      await storage.delete('private', other.storage_key);
      expect((await get(`/payment-proofs/${other.id}/file`)).status).toBe(410);
    });

    it('answers 404 for an unknown proof or something that is not an id', async () => {
      for (const id of ['00000000-0000-0000-0000-000000000000', 'nope']) {
        const res = await get(`/payment-proofs/${id}/file`);
        expect(res.status).toBe(404);
        expect(errorBody(res).code).toBe('NOT_FOUND');
      }
    });

    it('rejects other download values', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      for (const q of ['download=false', 'download=1', 'x=1']) {
        expect(
          (await get(`/payment-proofs/${proof.id}/file?${q}`)).status,
        ).toBe(400);
      }
    });
  });

  describe('accepting and rejecting (#72)', () => {
    it('accepts a proof, records who and when, and leaves the booking alone', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      const res = await patch(`/payment-proofs/${proof.id}`, {
        status: 'accepted',
      });
      expect(res.status).toBe(200);
      expect(proofOf(res).proof).toMatchObject({
        id: proof.id,
        status: 'accepted',
        rejectionReason: null,
        reviewedBy: admin.id,
      });
      expect(proofOf(res).proof.reviewedAt).not.toBeNull();
      expect('emailSentTo' in proofOf(res)).toBe(false);

      // Accepting doesn't confirm the booking (BR-8) and sends nothing
      const after = await bookingRow(booking.id);
      expect(after.status).toBe('pending');
      expect(after.payment_verified_at).toBeNull();
      expect(provider.sent).toHaveLength(0);
    });

    it('rejects a proof, records the reason, and emails the client without a link', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      const reason = 'The amount does not match the deposit.';
      const res = await patch(`/payment-proofs/${proof.id}`, {
        status: 'rejected',
        rejectionReason: `  ${reason}  `,
      });
      expect(res.status).toBe(200);
      expect(proofOf(res).proof).toMatchObject({
        status: 'rejected',
        rejectionReason: reason,
        reviewedBy: admin.id,
      });
      expect(proofOf(res).emailSentTo).toBe(booking.client_email);

      const [email] = toClient(booking.client_email);
      expect(email.subject).toBe(
        `Please check your proof of payment for ${booking.reference}`,
      );
      expect(email.text).toContain(`"${reason}"`);
      expect(email.text).toContain('/lookup.html');
      // No booking link of any kind (BR-14)
      expect(email.text).not.toMatch(/\/booking\/[\w-]{20,}/);
      expect(email.html).not.toMatch(/\/booking\/[\w-]{20,}/);

      const notification = await db
        .selectFrom('notifications')
        .selectAll()
        .where('type', '=', 'proof_rejected')
        .executeTakeFirstOrThrow();
      expect(notification).toMatchObject({ status: 'sent' });
      // The booking is unchanged: still Pending, deadline kept (BR-9)
      const after = await bookingRow(booking.id);
      expect(after.status).toBe('pending');
      expect(after.deposit_due_at).toEqual(booking.deposit_due_at);
    });

    it('shows a rejected proof on the booking and as rejected payment', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      await patch(`/payment-proofs/${proof.id}`, {
        status: 'rejected',
        rejectionReason: 'Blurry',
      });
      const detail = bodyOf<{
        booking: { paymentStatus: string };
        proofs: ProofJson[];
      }>(await get(`/bookings/${booking.id}`));
      expect(detail.booking.paymentStatus).toBe('proof_rejected');
      expect(detail.proofs[0]).toMatchObject({
        status: 'rejected',
        rejectionReason: 'Blurry',
      });
    });

    it('needs a reason to reject, and allows none on accept', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      for (const payload of [
        { status: 'rejected' },
        { status: 'rejected', rejectionReason: '   ' },
        { status: 'rejected', rejectionReason: 'x'.repeat(501) },
        { status: 'accepted', rejectionReason: 'because' },
        { status: 'received' },
        { status: 'pending' },
        {},
        { status: 'accepted', extra: 1 },
        { status: 'rejected', rejectionReason: 42 },
      ]) {
        const res = await patch(`/payment-proofs/${proof.id}`, payload);
        expect(res.status).toBe(400);
        expect(errorBody(res).code).toBe('VALIDATION_FAILED');
      }
      expect((await proofRow(proof.id)).status).toBe('received');
      expect(provider.sent).toHaveLength(0);
      // 500 characters is the limit and is fine
      const ok = await patch(`/payment-proofs/${proof.id}`, {
        status: 'rejected',
        rejectionReason: 'x'.repeat(500),
      });
      expect(ok.status).toBe(200);
    });

    it('can be reviewed only once', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      await patch(`/payment-proofs/${proof.id}`, { status: 'accepted' });
      const again = await patch(`/payment-proofs/${proof.id}`, {
        status: 'rejected',
        rejectionReason: 'Changed my mind',
      });
      expect(again.status).toBe(409);
      expect(errorBody(again).code).toBe('PROOF_ALREADY_REVIEWED');
      expect((await proofRow(proof.id)).status).toBe('accepted');
      expect(provider.sent).toHaveLength(0);
    });

    it('lets only one of two simultaneous reviews win', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      const results = await Promise.all([
        patch(`/payment-proofs/${proof.id}`, { status: 'accepted' }),
        patch(`/payment-proofs/${proof.id}`, {
          status: 'rejected',
          rejectionReason: 'No',
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('does not email when the booking is no longer waiting for a deposit', async () => {
      const booking = await insertBooking({ status: 'confirmed' });
      const proof = await insertProof(booking.id);
      const res = await patch(`/payment-proofs/${proof.id}`, {
        status: 'rejected',
        rejectionReason: 'Old proof',
      });
      expect(res.status).toBe(200);
      expect(proofOf(res).emailSentTo).toBeNull();
      expect(provider.sent).toHaveLength(0);
    });

    it('stays rejected, and says no email was sent, when the email fails', async () => {
      provider.failWith = 'the mail server is down';
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      const res = await patch(`/payment-proofs/${proof.id}`, {
        status: 'rejected',
        rejectionReason: 'Unreadable',
      });
      expect(res.status).toBe(200);
      expect(proofOf(res).emailSentTo).toBeNull();
      expect((await proofRow(proof.id)).status).toBe('rejected');
    });

    it('takes a reviewed proof out of "awaiting review"', async () => {
      const booking = await insertBooking();
      const proof = await insertProof(booking.id);
      const awaiting = async () =>
        bodyOf<{ proofsAwaitingReview: number }>(await get('/dashboard'))
          .proofsAwaitingReview;
      const before = await awaiting();
      await patch(`/payment-proofs/${proof.id}`, { status: 'accepted' });
      expect(await awaiting()).toBe(before - 1);
      const list = bodyOf<{ items: { id: string }[] }>(
        await get('/bookings?proof=received&q=proofs-test@example.com'),
      );
      expect(list.items.map((b) => b.id)).not.toContain(booking.id);
    });

    it('answers 404 for an unknown proof', async () => {
      const res = await patch(
        '/payment-proofs/00000000-0000-0000-0000-000000000000',
        { status: 'accepted' },
      );
      expect(res.status).toBe(404);
    });
  });

  describe('the calendar (#76)', () => {
    const day = (iso: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Johannesburg',
      }).format(iso);
    const events = async (query: string) =>
      bodyOf<{
        timeZone: string;
        events: {
          id: string;
          reference: string;
          title: string;
          start: string;
          end: string;
          status: string;
        }[];
        blockedTimes: {
          id: string;
          start: string;
          end: string;
          reason: string | null;
        }[];
      }>(await get(`/calendar?${query}`));

    it('lists the appointments in the range with the booking’s status', async () => {
      const pending = await insertBooking();
      const confirmed = await insertBooking({ status: 'confirmed' });
      const d1 = day(pending.start_at);
      const body = await events(`from=${d1}&to=${d1}`);
      expect(body.timeZone).toBe('Africa/Johannesburg');
      expect(body.events).toEqual([
        {
          id: pending.id,
          reference: pending.reference,
          title: `${PREFIX}Soft Glam · ${pending.client_name}`,
          start: pending.start_at.toISOString().replace('.000Z', 'Z'),
          end: pending.end_at.toISOString().replace('.000Z', 'Z'),
          status: 'pending',
        },
      ]);
      const d2 = day(confirmed.start_at);
      const second = await events(`from=${d2}&to=${d2}`);
      expect(second.events.map((e) => e.status)).toEqual(['confirmed']);
    });

    it('leaves out Cancelled and Expired unless asked', async () => {
      const cancelled = await insertBooking({ status: 'cancelled' });
      const expired = await insertBooking({ status: 'expired' });
      const d1 = day(cancelled.start_at);
      const d2 = day(expired.start_at);
      expect((await events(`from=${d1}&to=${d1}`)).events).toEqual([]);
      expect((await events(`from=${d2}&to=${d2}`)).events).toEqual([]);
      expect(
        (await events(`from=${d1}&to=${d1}&includeCancelled=true`)).events.map(
          (e) => e.status,
        ),
      ).toEqual(['cancelled']);
      expect(
        (await events(`from=${d2}&to=${d2}&includeCancelled=true`)).events.map(
          (e) => e.status,
        ),
      ).toEqual(['expired']);
    });

    it('counts days in the business time zone, both ends included', async () => {
      // 23:30 on the last day is in; 00:30 the next day is out
      const lastDay = addDays(upcoming(3), 200);
      const late = localAt(lastDay, '23:00');
      const inside = await insertBooking({
        start_at: late,
        end_at: new Date(late.getTime() + 30 * 60_000),
        occupied_until: new Date(late.getTime() + 60 * 60_000),
      });
      const nextDay = localAt(addDays(lastDay, 1), '00:30');
      const outside = await insertBooking({
        start_at: nextDay,
        end_at: new Date(nextDay.getTime() + 30 * 60_000),
        occupied_until: new Date(nextDay.getTime() + 60 * 60_000),
      });
      const ids = (await events(`from=${lastDay}&to=${lastDay}`)).events.map(
        (e) => e.id,
      );
      expect(ids).toContain(inside.id);
      expect(ids).not.toContain(outside.id);
    });

    it('lists the blocked times that overlap the range', async () => {
      const dayStr = addDays(upcoming(4), 300);
      const start = localAt(dayStr, '09:00');
      const blocked = await db
        .insertInto('blocked_times')
        .values({
          start_at: start,
          end_at: new Date(start.getTime() + 3_600_000),
          reason: `${PREFIX}Wedding trial`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const inRange = await events(`from=${dayStr}&to=${dayStr}`);
      expect(inRange.blockedTimes).toEqual([
        {
          id: blocked.id,
          start: start.toISOString().replace('.000Z', 'Z'),
          end: new Date(start.getTime() + 3_600_000)
            .toISOString()
            .replace('.000Z', 'Z'),
          reason: `${PREFIX}Wedding trial`,
        },
      ]);
      const elsewhere = await events(
        `from=${addDays(dayStr, 2)}&to=${addDays(dayStr, 3)}`,
      );
      expect(elsewhere.blockedTimes).toEqual([]);
    });

    it.each([
      [''],
      ['from=2026-11-01'],
      ['to=2026-11-30'],
      ['from=2026-11-30&to=2026-11-01'],
      ['from=2026-01-01&to=2026-12-31'],
      ['from=2026-13-01&to=2026-13-02'],
      ['from=yesterday&to=today'],
      ['from=2026-11-01&to=2026-11-30&includeCancelled=maybe'],
      ['from=2026-11-01&to=2026-11-30&extra=1'],
    ])('rejects ?%s', async (query) => {
      const res = await get(`/calendar?${query}`);
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    });

    it('allows exactly 62 days, but not 63', async () => {
      expect(
        (await get('/calendar?from=2026-11-01&to=2027-01-02')).status,
      ).toBe(200);
      expect(
        (await get('/calendar?from=2026-11-01&to=2027-01-03')).status,
      ).toBe(400);
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
