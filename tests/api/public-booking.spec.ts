import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
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
import { PublicBookingService } from '../../src/bookings/public-booking.service.js';
import { createTestDatabase } from '../helpers/database.js';
import { localAt, upcoming } from '../helpers/dates.js';
import { bodyOf, errorBody } from '../helpers/http.js';

// /api/booking/:token and /booking/:token: what a client can do with their
// private booking link (C-7, C-8, BR-12, BR-14, BR-15; docs/api.md section 5).

class FakeEmailProvider implements EmailProvider {
  sent: EmailMessage[] = [];
  failWith: string | null = null;
  send(message: EmailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(new Error(this.failWith));
    this.sent.push(message);
    return Promise.resolve();
  }
}

const PREFIX = 'Public booking test ';
const BANKING = {
  accountName: 'Fresh Start Home Services',
  bank: 'Example Bank',
  accountNumber: '1234567890',
  branchCode: '250655',
  accountType: 'Cheque',
};
const sha256 = (data: string | Buffer) =>
  createHash('sha256').update(data).digest();
const PDF = Buffer.from('%PDF-1.4\n%test proof of payment\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64),
]);

describe('Booking link API', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let provider: FakeEmailProvider;
  let storage: LocalFileStorage;
  let uploadDir: string;
  let service: { id: string };
  let originalSettings: Selectable<DB['settings']>;
  let ownerEmail: string;
  let counter = 0;

  beforeAll(async () => {
    db = createTestDatabase();
    originalSettings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();
    ownerEmail = originalSettings.business_email;
    await db
      .updateTable('settings')
      .set({ banking_details: JSON.stringify(BANKING) })
      .where('id', '=', 1)
      .execute();
    provider = new FakeEmailProvider();
    uploadDir = await mkdtemp(join(tmpdir(), 'mbg-proofs-'));
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
    service = await db
      .insertInto('services')
      .values({
        name: `${PREFIX}Standard Clean`,
        price: '650.00',
        duration_minutes: 90,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  });

  beforeEach(async () => {
    app.get<SlidingWindowLimiter>(RATE_LIMITER).reset();
    provider.sent = [];
    provider.failWith = null;
    for (const key of await storage.list('private')) {
      await storage.delete('private', key);
    }
  });

  afterEach(async () => {
    await clean(db, service.id);
    await db
      .updateTable('settings')
      .set({
        deposit_refundable: originalSettings.deposit_refundable,
        refund_cutoff_hours: originalSettings.refund_cutoff_hours,
      })
      .where('id', '=', 1)
      .execute();
  });

  afterAll(async () => {
    await clean(db, service.id);
    await db
      .updateTable('settings')
      .set({
        ...originalSettings,
        banking_details: JSON.stringify(originalSettings.banking_details),
      })
      .where('id', '=', 1)
      .execute();
    await db
      .deleteFrom('services')
      .where('name', 'like', `${PREFIX}%`)
      .execute();
    await db
      .deleteFrom('users')
      .where('email', '=', 'public-booking@example.com')
      .execute();
    await app.close();
    await db.destroy();
    await rm(uploadDir, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());

  // A booking saved directly, on its own day. Returns the raw token, the way
  // the client holds it in their email.
  async function insert(overrides: Partial<Insertable<DB['bookings']>> = {}) {
    counter += 1;
    const start = localAt(addDays(upcoming(2), counter * 7), '09:00');
    const status = overrides.status ?? 'pending';
    const token = randomBytes(32).toString('base64url');
    const confirmed: Partial<Insertable<DB['bookings']>> =
      status === 'confirmed'
        ? {
            amount_received: '325.00',
            payment_verified_at: new Date(),
            payment_verified_by: null,
          }
        : {};
    // payment_verified_by is required with the amount: use any real user if
    // present, else skip confirmed data
    const row = await db
      .insertInto('bookings')
      .values({
        service_id: service.id,
        client_name: `Client ${counter}`,
        client_email: `client${counter}.link-test@example.com`,
        client_phone: `+2782556${String(1000 + counter)}`,
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
        ...(await verifiedBy(confirmed)),
        ...overrides,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { row, token };
  }
  // Confirmed bookings need a confirming admin on record (a database rule)
  let adminId: string | null = null;
  async function verifiedBy(
    base: Partial<Insertable<DB['bookings']>>,
  ): Promise<Partial<Insertable<DB['bookings']>>> {
    if (!base.amount_received) return base;
    if (!adminId) {
      const { seedAdmin } = await import('../../src/auth/seed-admin.js');
      const made = await db.transaction().execute((trx) =>
        seedAdmin(trx, {
          email: 'public-booking@example.com',
          password: 'test-admin-password',
        }),
      );
      adminId = made.id;
    }
    return { ...base, payment_verified_by: adminId };
  }

  const view = (token: string) => http().get(`/api/booking/${token}`);
  const upload = (
    token: string,
    file: Buffer = PDF,
    filename = 'proof.pdf',
    contentType = 'application/pdf',
  ) =>
    http()
      .post(`/api/booking/${token}/proofs`)
      .attach('file', file, { filename, contentType });
  const cancel = (token: string) => http().post(`/api/booking/${token}/cancel`);
  const row = (id: string) =>
    db
      .selectFrom('bookings')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const proofs = (id: string) =>
    db
      .selectFrom('payment_proofs')
      .selectAll()
      .where('booking_id', '=', id)
      .execute();
  const toOwner = () => provider.sent.filter((m) => m.to === ownerEmail);
  const toClient = (email: string) =>
    provider.sent.filter((m) => m.to === email);
  const NOT_VALID = {
    statusCode: 404,
    code: 'LINK_NOT_VALID',
    message: expect.any(String) as string,
    details: null,
  };

  describe('which links work', () => {
    it('answers one identical 404 for any link that does not work', async () => {
      const expired = await insert({ status: 'expired' });
      const cancelled = await insert({
        status: 'cancelled',
        cancelled_at: new Date(),
        cancelled_by: 'client',
      });
      const started = new Date(Date.now() - 3_600_000);
      const past = await insert({
        start_at: started,
        end_at: new Date(started.getTime() + 60_000),
        occupied_until: new Date(started.getTime() + 120_000),
      });
      const tokens = [
        randomBytes(32).toString('base64url'), // unknown
        'short',
        'x'.repeat(500),
        expired.token,
        cancelled.token,
        past.token,
      ];
      const bodies = [];
      for (const token of tokens) {
        for (const send of [view, upload, cancel]) {
          // Each call is one probe: don't let the rate limit answer instead
          app.get<SlidingWindowLimiter>(RATE_LIMITER).reset();
          const res = await send(encodeURIComponent(token));
          expect(res.status).toBe(404);
          bodies.push(res.body);
          // The same headers whatever the reason
          expect(res.headers['referrer-policy']).toBe('no-referrer');
          expect(res.headers['cache-control']).toBe('no-store');
        }
      }
      for (const body of bodies) expect(body).toEqual(NOT_VALID);
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    });

    it('stops working once a new link replaces it', async () => {
      const { row: booking, token } = await insert();
      expect((await view(token)).status).toBe(200);
      await db
        .updateTable('bookings')
        .set({
          booking_token_hash: sha256('a different token'.padEnd(43, 'x')),
        })
        .where('id', '=', booking.id)
        .execute();
      expect((await view(token)).status).toBe(404);
    });
  });

  describe('the booking page (#68)', () => {
    it('serves the page for any token, with headers that keep the link private', async () => {
      const res = await http().get(
        `/booking/${randomBytes(32).toString('base64url')}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex');
      expect(res.text).toContain('<meta name="referrer" content="no-referrer"');
      expect(res.text).toContain('<meta name="robots" content="noindex"');
    });

    it('loads no third-party scripts', async () => {
      const res = await http().get('/booking/anything');
      const scripts = [
        ...res.text.matchAll(/<script[^>]*\ssrc="([^"]+)"/g),
      ].map((m) => m[1]);
      expect(scripts.length).toBeGreaterThan(0);
      for (const src of scripts) expect(src.startsWith('/')).toBe(true);
    });

    it('shows a Pending booking with the banking details and what can be done', async () => {
      const { row: booking, token } = await insert();
      const res = await view(token);
      expect(res.status).toBe(200);
      const body = bodyOf<{
        booking: Record<string, unknown>;
        bankingDetails: unknown;
        business: unknown;
        canUploadProof: boolean;
        proofsRemaining: number;
        canCancel: boolean;
        cancellation: Record<string, unknown>;
      }>(res);
      expect(body.booking).toMatchObject({
        reference: booking.reference,
        status: 'pending',
        paymentStatus: 'awaiting_payment',
        service: { name: `${PREFIX}Standard Clean`, durationMinutes: 90 },
        price: '650.00',
        depositAmount: '325.00',
      });
      expect(body.bankingDetails).toEqual(BANKING);
      expect(body.business).toMatchObject({
        name: expect.any(String) as string,
      });
      expect(body).toMatchObject({
        canUploadProof: true,
        proofsRemaining: 3,
        canCancel: true,
        cancellation: {
          refundEligible: false,
          refundAmount: null,
          explanation: expect.stringContaining(
            "hasn't been confirmed yet",
          ) as string,
        },
      });
      expect(JSON.stringify(body)).not.toContain(token);
    });

    it('shows a Confirmed booking without banking details, with its refund terms', async () => {
      const { token } = await insert({ status: 'confirmed' });
      const body = bodyOf<{
        bankingDetails: unknown;
        canUploadProof: boolean;
        cancellation: {
          refundEligible: boolean;
          refundAmount: string;
          explanation: string;
        };
      }>(await view(token));
      expect(body.bankingDetails).toBeNull();
      expect(body.canUploadProof).toBe(false);
      expect(body.cancellation).toMatchObject({
        refundEligible: true,
        refundAmount: '325.00',
      });
      expect(body.cancellation.explanation).toContain('R325');
      expect(body.cancellation.explanation).toContain('24 hours');
    });

    it('says the deposit is not refundable inside the cut-off or when deposits never are', async () => {
      const soon = new Date(Date.now() + 5 * 3_600_000);
      const near = await insert({
        status: 'confirmed',
        start_at: soon,
        end_at: new Date(soon.getTime() + 60_000),
        occupied_until: new Date(soon.getTime() + 120_000),
      });
      const nearBody = bodyOf<{
        cancellation: { refundEligible: boolean; explanation: string };
      }>(await view(near.token));
      expect(nearBody.cancellation.refundEligible).toBe(false);
      expect(nearBody.cancellation.explanation).toContain('less than 24 hours');

      await db
        .updateTable('settings')
        .set({ deposit_refundable: false })
        .where('id', '=', 1)
        .execute();
      const far = await insert({ status: 'confirmed' });
      const farBody = bodyOf<{
        cancellation: { refundEligible: boolean; explanation: string };
      }>(await view(far.token));
      expect(farBody.cancellation.refundEligible).toBe(false);
      expect(farBody.cancellation.explanation).toContain("aren't refundable");
    });

    it('never changes the booking, however often it is opened', async () => {
      const { row: booking, token } = await insert();
      const before = await row(booking.id);
      for (let i = 0; i < 3; i++) await view(token);
      await http().get(`/booking/${token}`);
      await http().get(`/api/booking/${token}/cancel`); // a GET can't cancel
      const after = await row(booking.id);
      expect(after).toEqual(before);
      expect(provider.sent).toHaveLength(0);
    });
  });

  describe('uploading a proof of payment (#69)', () => {
    it('stores the file privately and records it', async () => {
      const { row: booking, token } = await insert();
      const before = await row(booking.id);
      const res = await upload(token);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        proof: {
          uploadedAt: expect.any(String) as string,
          status: 'received',
          rejectionReason: null,
        },
        proofsRemaining: 2,
        message:
          'Thank you. Your booking will be confirmed once the payment reflects in our account.',
      });

      const [proof] = await proofs(booking.id);
      expect(proof).toMatchObject({
        original_filename: 'proof.pdf',
        content_type: 'application/pdf',
        size_bytes: PDF.length,
        status: 'received',
      });
      expect(proof.sha256).toEqual(sha256(PDF));
      expect(proof.storage_key).toMatch(/^[a-f0-9]{64}$/);
      expect(proof.uploaded_from_ip).toBeTruthy();
      // The file is under that random key, in the private area, with the same bytes
      expect(await storage.list('private')).toEqual([proof.storage_key]);
      expect(await storage.read('private', proof.storage_key)).toEqual(PDF);
      expect(await storage.list('public')).toEqual([]);

      // Uploading never changes the status or the deadline (BR-3, BR-9)
      const after = await row(booking.id);
      expect(after.status).toBe('pending');
      expect(after.deposit_due_at).toEqual(before.deposit_due_at);
    });

    it('accepts JPEG and PNG files too', async () => {
      const { token } = await insert();
      expect(
        (await upload(token, JPEG, 'photo.jpg', 'image/jpeg')).status,
      ).toBe(201);
      expect(
        (await upload(token, PNG, 'screenshot.png', 'image/png')).status,
      ).toBe(201);
    });

    it('decides by the file’s bytes, not its name or claimed type', async () => {
      const { row: booking, token } = await insert();
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      for (const [file, name, type] of [
        [html, 'proof.pdf', 'application/pdf'],
        [Buffer.from('GIF89a......'), 'proof.png', 'image/png'],
        [Buffer.from('MZ\x90\x00'), 'proof.jpg', 'image/jpeg'],
        [Buffer.from('plain text'), 'proof.pdf', 'application/pdf'],
      ] as const) {
        const res = await upload(token, file, name, type);
        expect(res.status).toBe(415);
        expect(errorBody(res).code).toBe('UNSUPPORTED_FILE_TYPE');
      }
      // A real PDF with a wrong name and type is fine
      expect((await upload(token, PDF, 'proof.txt', 'text/plain')).status).toBe(
        201,
      );
      expect(await proofs(booking.id)).toHaveLength(1);
      expect(await storage.list('private')).toHaveLength(1);
    });

    it('refuses an empty file, a missing file and a second file', async () => {
      const { row: booking, token } = await insert();
      const empty = await upload(token, Buffer.alloc(0));
      expect(empty.status).toBe(400);
      expect(errorBody(empty).code).toBe('FILE_INVALID');

      const none = await http().post(`/api/booking/${token}/proofs`).send({});
      expect(none.status).toBe(400);
      expect(errorBody(none).code).toBe('FILE_MISSING');

      const noFile = await http()
        .post(`/api/booking/${token}/proofs`)
        .attach('other', PDF, { filename: 'proof.pdf' });
      expect(noFile.status).toBe(400);

      const two = await http()
        .post(`/api/booking/${token}/proofs`)
        .attach('file', PDF, { filename: 'a.pdf' })
        .attach('file', PDF, { filename: 'b.pdf' });
      expect(two.status).toBe(400);

      const withField = await http()
        .post(`/api/booking/${token}/proofs`)
        .field('note', 'hi')
        .attach('file', PDF, { filename: 'a.pdf' });
      expect(withField.status).toBe(400);

      expect(await proofs(booking.id)).toHaveLength(0);
      expect(await storage.list('private')).toHaveLength(0);
    });

    it('refuses a file over 5 MB and stores nothing', async () => {
      const { row: booking, token } = await insert();
      const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
      const res = await upload(token, big);
      expect(res.status).toBe(413);
      expect(errorBody(res).code).toBe('FILE_TOO_LARGE');
      expect(await proofs(booking.id)).toHaveLength(0);
      expect(await storage.list('private')).toHaveLength(0);
      // Just under the limit is fine
      const ok = Buffer.concat([
        PDF,
        Buffer.alloc(5 * 1024 * 1024 - PDF.length - 1024),
      ]);
      expect((await upload(token, ok)).status).toBe(201);
    });

    it('keeps only a safe version of the filename, as a label', async () => {
      const { row: booking, token } = await insert();
      await upload(token, PDF, '../../etc/evil.pdf');
      const [proof] = await proofs(booking.id);
      expect(proof.original_filename).toBe('evil.pdf');
      expect(proof.storage_key).not.toContain('evil');
    });

    it('allows 3 proofs, then 409 PROOF_LIMIT_REACHED', async () => {
      const { row: booking, token } = await insert();
      const remaining = [];
      for (let i = 0; i < 3; i++) {
        const res = await upload(token);
        expect(res.status).toBe(201);
        remaining.push(
          bodyOf<{ proofsRemaining: number }>(res).proofsRemaining,
        );
      }
      expect(remaining).toEqual([2, 1, 0]);
      const fourth = await upload(token);
      expect(fourth.status).toBe(409);
      expect(errorBody(fourth).code).toBe('PROOF_LIMIT_REACHED');
      expect(await proofs(booking.id)).toHaveLength(3);
      expect(await storage.list('private')).toHaveLength(3);

      const page = bodyOf<{ canUploadProof: boolean; proofsRemaining: number }>(
        await view(token),
      );
      expect(page).toMatchObject({ canUploadProof: false, proofsRemaining: 0 });
    });

    it('lets 5 parallel uploads through only 3, and leaves no stray files', async () => {
      const { row: booking, token } = await insert();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => upload(token)),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 201, 409, 409]);
      expect(await proofs(booking.id)).toHaveLength(3);
      // The two refused uploads were cleaned up again
      expect(await storage.list('private')).toHaveLength(3);
    });

    // The request limits (5 an hour per booking) and the speed of one request
    // hide a missing row lock, so this one goes straight at the service: 8
    // uploads starting together must still end with exactly 3 proofs
    it('counts simultaneous uploads one at a time, so the limit of 3 holds', async () => {
      const { row: booking, token } = await insert();
      const link = await db
        .selectFrom('bookings')
        .selectAll()
        .where('id', '=', booking.id)
        .executeTakeFirstOrThrow();
      const service = app.get(PublicBookingService);
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          service.uploadProof(
            link,
            { buffer: PDF, originalname: 'p.pdf' },
            '127.0.0.1',
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(await proofs(booking.id)).toHaveLength(3);
      expect(await storage.list('private')).toHaveLength(3);
      expect(token).toBeDefined();
    });

    it('refuses a Confirmed booking before reading the file', async () => {
      const { row: booking, token } = await insert({ status: 'confirmed' });
      const res = await upload(token);
      expect(res.status).toBe(409);
      expect(errorBody(res).code).toBe('BOOKING_NOT_PENDING');
      expect(await proofs(booking.id)).toHaveLength(0);
      expect(await storage.list('private')).toHaveLength(0);
    });

    it('limits one booking to 5 attempts an hour', async () => {
      const { token } = await insert();
      for (let i = 0; i < 5; i++)
        await upload(token, Buffer.from('not a proof'));
      const sixth = await upload(token);
      expect(sixth.status).toBe(429);
      expect(sixth.headers['retry-after']).toBeDefined();
    });

    it('limits one IP address to 10 attempts an hour across bookings', async () => {
      const links = [];
      for (let i = 0; i < 3; i++) links.push(await insert());
      let last = 0;
      for (let i = 0; i < 11; i++) {
        last = (await upload(links[i % 3].token, Buffer.from('nope'))).status;
      }
      expect(last).toBe(429);
    });

    it('tells the owner, with the reference, client, deposit, deadline and a link to the booking', async () => {
      const { row: booking, token } = await insert({
        client_name: 'Sarah Mokoena',
      });
      await upload(token);
      await upload(token);
      expect(toOwner()).toHaveLength(2);
      const email = toOwner()[1];
      expect(email.subject).toBe(
        `Proof of payment uploaded: ${booking.reference}, Sarah Mokoena`,
      );
      for (const part of [
        booking.reference,
        'Sarah Mokoena',
        'R325',
        '(2 of 3)',
        `/admin/booking.html?id=${booking.id}`,
      ]) {
        expect(email.text).toContain(part);
      }
      expect(email.text).not.toContain(token);
      const notification = await db
        .selectFrom('notifications')
        .selectAll()
        .where('type', '=', 'admin_proof_uploaded')
        .execute();
      expect(notification).toHaveLength(2);
    });

    it('still accepts the upload when the owner’s email cannot be sent', async () => {
      provider.failWith = 'the mail server is down';
      const { row: booking, token } = await insert();
      const res = await upload(token);
      expect(res.status).toBe(201);
      expect(await proofs(booking.id)).toHaveLength(1);
    });
  });

  describe('cancelling (#73)', () => {
    it('cancels a Pending booking, frees the slot and emails both', async () => {
      const { row: booking, token } = await insert();
      const res = await cancel(token);
      expect(res.status).toBe(200);
      expect(
        bodyOf<{
          booking: { status: string };
          refundDue: boolean;
          refundAmount: null;
        }>(res),
      ).toMatchObject({
        booking: { status: 'cancelled' },
        refundDue: false,
        refundAmount: null,
      });
      const saved = await row(booking.id);
      expect(saved).toMatchObject({
        status: 'cancelled',
        cancelled_by: 'client',
        refund_due: false,
      });
      expect(saved.cancelled_at).not.toBeNull();

      const client = toClient(booking.client_email);
      expect(client).toHaveLength(1);
      expect(client[0].text).toContain(
        'As requested, your booking has been cancelled',
      );
      expect(client[0].text).toContain('No deposit had been confirmed');
      expect(toOwner()).toHaveLength(1);
      expect(toOwner()[0].subject).toContain('Cancelled:');
      expect(toOwner()[0].text).toContain('Status before cancelling: Pending');

      // The time is free again
      await expect(
        db
          .insertInto('bookings')
          .values({
            service_id: service.id,
            client_name: 'Next',
            client_email: 'next.link-test@example.com',
            client_phone: '+27825559999',
            start_at: booking.start_at,
            end_at: booking.end_at,
            occupied_until: booking.occupied_until,
            price_at_booking: '650.00',
            deposit_amount: '325.00',
            deposit_due_at: new Date(Date.now() + 86_400_000),
            status: 'pending',
          })
          .execute(),
      ).resolves.toBeDefined();
    });

    it('marks a refund due when a Confirmed booking is cancelled in time', async () => {
      const { row: booking, token } = await insert({ status: 'confirmed' });
      const res = await cancel(token);
      expect(res.status).toBe(200);
      expect(
        bodyOf<{ refundDue: boolean; refundAmount: string }>(res),
      ).toMatchObject({
        refundDue: true,
        refundAmount: '325.00',
      });
      expect(await row(booking.id)).toMatchObject({
        status: 'cancelled',
        refund_due: true,
        refunded_at: null,
      });
      expect(toClient(booking.client_email)[0].text).toContain(
        "Your deposit of R325 will be refunded. I'll be in touch to arrange it.",
      );
      expect(toOwner()[0].subject).toBe(
        `Refund due: ${booking.client_name} cancelled ${booking.reference}`,
      );
      expect(toOwner()[0].text).toContain('Refund due: R325.');
    });

    it('marks no refund inside the cut-off, and says so to both', async () => {
      const soon = new Date(Date.now() + 5 * 3_600_000);
      const { row: booking, token } = await insert({
        status: 'confirmed',
        start_at: soon,
        end_at: new Date(soon.getTime() + 60_000),
        occupied_until: new Date(soon.getTime() + 120_000),
      });
      const res = await cancel(token);
      expect(bodyOf<{ refundDue: boolean }>(res).refundDue).toBe(false);
      expect((await row(booking.id)).refund_due).toBe(false);
      expect(toClient(booking.client_email)[0].text).toContain(
        "your deposit isn't refundable",
      );
      expect(toOwner()[0].text).toContain(
        'No refund is due: they cancelled after the refund cut-off.',
      );
    });

    it('marks no refund when deposits are never refundable', async () => {
      await db
        .updateTable('settings')
        .set({ deposit_refundable: false })
        .where('id', '=', 1)
        .execute();
      const { row: booking, token } = await insert({ status: 'confirmed' });
      expect(
        bodyOf<{ refundDue: boolean }>(await cancel(token)).refundDue,
      ).toBe(false);
      expect((await row(booking.id)).refund_due).toBe(false);
    });

    it('ends the link: it cannot be used again', async () => {
      const { token } = await insert();
      expect((await cancel(token)).status).toBe(200);
      for (const send of [view, upload, cancel]) {
        const res = await send(token);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(NOT_VALID);
      }
    });

    it('cancels once even when pressed twice at the same time', async () => {
      const { row: booking, token } = await insert({ status: 'confirmed' });
      const results = await Promise.all([cancel(token), cancel(token)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      expect(toClient(booking.client_email)).toHaveLength(1);
      expect(toOwner()).toHaveLength(1);
    });

    it('stays cancelled when the emails cannot be sent', async () => {
      provider.failWith = 'the mail server is down';
      const { row: booking, token } = await insert();
      expect((await cancel(token)).status).toBe(200);
      expect((await row(booking.id)).status).toBe('cancelled');
    });

    it('limits one IP address to 5 cancel attempts an hour', async () => {
      for (let i = 0; i < 5; i++) await cancel('x'.repeat(43));
      const sixth = await cancel('x'.repeat(43));
      expect(sixth.status).toBe(429);
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
