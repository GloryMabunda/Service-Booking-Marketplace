import { createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Insertable, Kysely, Selectable } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../../src/app.factory.js';
import { AppModule } from '../../src/app.module.js';
import { addDays } from '../../src/availability/time-zone.js';
import type { AdminBooking } from '../../src/bookings/admin-bookings.service.js';
import type { DB } from '../../src/database/database.types.js';
import {
  EMAIL_PROVIDER,
  type EmailMessage,
  type EmailProvider,
} from '../../src/notifications/email-provider.js';
import {
  RATE_LIMITER,
  type SlidingWindowLimiter,
} from '../../src/common/rate-limit.js';
import {
  removeTestAdmin,
  signInTestAdmin,
  type TestAdmin,
} from '../helpers/admin.js';
import { createTestDatabase } from '../helpers/database.js';
import { localAt, upcoming } from '../helpers/dates.js';
import { bodyOf, errorBody } from '../helpers/http.js';

// /api/admin/dashboard and /api/admin/bookings: the owner's view of bookings
// and what she can do with them (A-2, A-3, A-4; docs/api.md 7.1 to 7.8).

class FakeEmailProvider implements EmailProvider {
  sent: EmailMessage[] = [];
  failWith: string | null = null;
  send(message: EmailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(new Error(this.failWith));
    this.sent.push(message);
    return Promise.resolve();
  }
}

const PREFIX = 'Admin bookings test ';
const sha256 = (text: string | Buffer) =>
  createHash('sha256').update(text).digest();
const TOKEN_IN_LINK = /http\S*\/booking\/([\w-]+)/;

describe('Admin bookings API', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let admin: TestAdmin;
  let provider: FakeEmailProvider;
  let service: { id: string };
  let originalSettings: Selectable<DB['settings']>;
  let counter = 0;

  beforeAll(async () => {
    db = createTestDatabase();
    originalSettings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();
    provider = new FakeEmailProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    admin = await signInTestAdmin(app, db, 'admin-bookings@example.com');
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
      .deleteFrom('services')
      .where('name', 'like', `${PREFIX}%`)
      .execute();
    await removeTestAdmin(db, admin);
    await app.close();
    await db.destroy();
  });

  const http = () => request(app.getHttpServer());
  const get = (path: string) =>
    http().get(`/api/admin${path}`).set('Cookie', admin.cookie);
  const post = (path: string, body: object = {}) =>
    http().post(`/api/admin${path}`).set('Cookie', admin.cookie).send(body);
  const patch = (path: string, body: object) =>
    http().patch(`/api/admin${path}`).set('Cookie', admin.cookie).send(body);
  const bookingOf = (res: request.Response) =>
    bodyOf<{ booking: AdminBooking }>(res).booking;

  // A booking saved directly, each on its own day so none overlap. Pending by
  // default; pass `status: 'confirmed'` and so on to start somewhere else.
  async function insert(
    overrides: Partial<Insertable<DB['bookings']>> = {},
    options: { token?: string } = {},
  ) {
    counter += 1;
    const day = addDays(upcoming(2), counter * 7);
    const start = localAt(day, '09:00');
    const status = overrides.status ?? 'pending';
    const extra: Partial<Insertable<DB['bookings']>> = {};
    if (status === 'confirmed' || status === 'completed') {
      extra.amount_received = '325.00';
      extra.payment_verified_at = new Date();
      extra.payment_verified_by = admin.id;
    }
    if (status === 'cancelled') {
      extra.cancelled_at = new Date();
      extra.cancelled_by = 'admin';
    }
    const token = options.token ?? randomBytes(32).toString('base64url');
    const row = await db
      .insertInto('bookings')
      .values({
        service_id: service.id,
        client_name: `Client ${counter}`,
        client_email: `client${counter}.admin-test@example.com`,
        client_phone: `+2782555${String(1000 + counter)}`,
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
    return { row, token };
  }
  const hashOf = async (id: string) =>
    (
      await db
        .selectFrom('bookings')
        .select('booking_token_hash')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).booking_token_hash;
  const statusOf = async (id: string) =>
    db
      .selectFrom('bookings')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const toClient = (row: { client_email: string }) =>
    provider.sent.filter((m) => m.to === row.client_email);
  const addProof = (bookingId: string, hash: Buffer, status = 'received') =>
    db
      .insertInto('payment_proofs')
      .values({
        booking_id: bookingId,
        content_type: 'application/pdf',
        original_filename: 'proof.pdf',
        sha256: hash,
        size_bytes: 1234,
        storage_key: randomBytes(8).toString('hex'),
        uploaded_from_ip: '196.25.1.1',
        status: status as 'received',
      })
      .execute();

  describe('who may use it', () => {
    it.each([
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/bookings'],
      ['GET', '/api/admin/bookings/00000000-0000-0000-0000-000000000000'],
      [
        'POST',
        '/api/admin/bookings/00000000-0000-0000-0000-000000000000/confirm-payment',
      ],
      [
        'PATCH',
        '/api/admin/bookings/00000000-0000-0000-0000-000000000000/status',
      ],
      [
        'PATCH',
        '/api/admin/bookings/00000000-0000-0000-0000-000000000000/deadline',
      ],
      [
        'POST',
        '/api/admin/bookings/00000000-0000-0000-0000-000000000000/booking-link',
      ],
    ])('%s %s needs a signed-in admin', async (method, path) => {
      const res = await http()[method.toLowerCase() as 'get'](path);
      expect(res.status).toBe(401);
    });
  });

  describe('dashboard (#62)', () => {
    it('counts what the owner needs to see', async () => {
      const before = bodyOf<Record<string, number>>(await get('/dashboard'));
      const pending = await insert();
      const confirmed = await insert({ status: 'confirmed' });
      await addProof(pending.row.id, sha256('a'));
      const refund = await insert({
        status: 'cancelled',
        refund_due: true,
        amount_received: '325.00',
        payment_verified_at: new Date(),
        payment_verified_by: admin.id,
      });
      await insert({
        status: 'cancelled',
        refund_due: true,
        refunded_at: new Date(),
        amount_received: '325.00',
        payment_verified_at: new Date(),
        payment_verified_by: admin.id,
      });

      const res = await get('/dashboard');
      expect(res.status).toBe(200);
      const after = bodyOf<Record<string, number>>(res);
      expect(after.upcoming - before.upcoming).toBe(2); // pending + confirmed
      expect(after.awaitingDeposit - before.awaitingDeposit).toBe(1);
      expect(after.proofsAwaitingReview - before.proofsAwaitingReview).toBe(1);
      expect(after.refundsDue - before.refundsDue).toBe(1); // not the refunded one
      expect(confirmed.row.status).toBe('confirmed');
      expect(refund.row.refund_due).toBe(true);
    });

    it('counts today’s bookings and this month’s completed ones', async () => {
      const before = bodyOf<Record<string, number>>(await get('/dashboard'));
      // Starting in one hour: today in most hours of the day, so use noon today
      const now = new Date();
      const todayStart = new Date(now.getTime() + 60_000);
      const inToday = await insert({
        status: 'confirmed',
        start_at: todayStart,
        end_at: new Date(todayStart.getTime() + 60_000),
        occupied_until: new Date(todayStart.getTime() + 120_000),
      });
      const past = new Date(now.getTime() - 3_600_000);
      await insert({
        status: 'completed',
        start_at: past,
        end_at: new Date(past.getTime() + 60_000),
        occupied_until: new Date(past.getTime() + 120_000),
      });
      const after = bodyOf<Record<string, number>>(await get('/dashboard'));
      // A booking one minute from now falls on today's date except in the
      // last minute of the business day
      expect(after.today - before.today).toBeLessThanOrEqual(1);
      expect(
        after.completedThisMonth - before.completedThisMonth,
      ).toBeLessThanOrEqual(1);
      expect(inToday.row.id).toBeDefined();
    });

    it('lists the next appointments, soonest first, at most 10', async () => {
      await insert();
      await insert({ status: 'confirmed' });
      const res = await get('/dashboard');
      const list = bodyOf<{
        upcomingAppointments: {
          startAt: string;
          reference: string;
          clientName: string;
          serviceName: string;
          status: string;
          id: string;
        }[];
      }>(res).upcomingAppointments;
      expect(list.length).toBeLessThanOrEqual(10);
      const times = list.map((a) => a.startAt);
      expect([...times].sort()).toEqual(times);
      expect(list[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String) as string,
          reference: expect.stringMatching(/^BK-\d+$/) as string,
          clientName: expect.any(String) as string,
          serviceName: expect.any(String) as string,
        }),
      );
    });
  });

  describe('list and filter (#63)', () => {
    it('returns the AdminBooking shape without the booking link', async () => {
      const { row } = await insert({ notes: 'Birthday makeup' });
      const res = await get(`/bookings?q=${row.reference}`);
      expect(res.status).toBe(200);
      const body = bodyOf<{
        items: AdminBooking[];
        page: number;
        pageSize: number;
        total: number;
      }>(res);
      expect(body).toMatchObject({ page: 1, pageSize: 25, total: 1 });
      expect(body.items[0]).toMatchObject({
        id: row.id,
        reference: row.reference,
        status: 'pending',
        paymentStatus: 'awaiting_payment',
        service: { id: service.id, name: `${PREFIX}Soft Glam` },
        client: {
          name: row.client_name,
          email: row.client_email,
          phone: row.client_phone,
        },
        price: '650.00',
        depositAmount: '325.00',
        amountReceived: null,
        refundDue: false,
        notes: 'Birthday makeup',
        proofCount: 0,
      });
      expect(body.items[0].bookingLinkIssuedAt).not.toBeNull();
      expect(JSON.stringify(body)).not.toMatch(/token/i);
    });

    it('filters by status', async () => {
      const pending = await insert();
      const confirmed = await insert({ status: 'confirmed' });
      const cancelled = await insert({ status: 'cancelled' });
      const refs = async (status: string) =>
        bodyOf<{ items: AdminBooking[] }>(
          await get(`/bookings?status=${status}&q=admin-test@example.com`),
        ).items.map((b) => b.reference);
      expect(await refs('pending')).toEqual([pending.row.reference]);
      expect((await refs('pending,confirmed')).sort()).toEqual(
        [pending.row.reference, confirmed.row.reference].sort(),
      );
      expect(await refs('cancelled')).toEqual([cancelled.row.reference]);
    });

    it('filters by date, as business-zone days', async () => {
      const first = await insert();
      const second = await insert();
      const day = (row: { start_at: Date }) =>
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Johannesburg',
        }).format(new Date(row.start_at));
      const refs = async (query: string) =>
        bodyOf<{ items: AdminBooking[] }>(
          await get(`/bookings?q=admin-test@example.com&${query}`),
        ).items.map((b) => b.reference);
      expect(await refs(`from=${day(first.row)}&to=${day(first.row)}`)).toEqual(
        [first.row.reference],
      );
      expect(await refs(`from=${day(second.row)}`)).toEqual([
        second.row.reference,
      ]);
      expect(await refs(`to=${day(first.row)}`)).toEqual([first.row.reference]);
    });

    it('filters to bookings with a proof awaiting review', async () => {
      const withProof = await insert();
      const reviewed = await insert();
      await insert();
      await addProof(withProof.row.id, sha256('one'));
      await db
        .insertInto('payment_proofs')
        .values({
          booking_id: reviewed.row.id,
          content_type: 'application/pdf',
          original_filename: 'old.pdf',
          sha256: sha256('two'),
          size_bytes: 10,
          storage_key: randomBytes(8).toString('hex'),
          uploaded_from_ip: '196.25.1.1',
          status: 'rejected',
          rejection_reason: 'Wrong amount',
          reviewed_at: new Date(),
          reviewed_by: admin.id,
        })
        .execute();
      const res = await get(
        '/bookings?proof=received&q=admin-test@example.com',
      );
      const items = bodyOf<{ items: AdminBooking[] }>(res).items;
      expect(items.map((b) => b.reference)).toEqual([withProof.row.reference]);
      expect(items[0]).toMatchObject({
        proofCount: 1,
        paymentStatus: 'proof_received',
      });
    });

    it('searches reference, name, email and phone, and treats % literally', async () => {
      const target = await insert({ client_name: 'Zanele Search-Me' });
      await insert();
      const find = async (q: string) =>
        bodyOf<{ items: AdminBooking[] }>(
          await get(`/bookings?q=${encodeURIComponent(q)}`),
        ).items.map((b) => b.reference);
      expect(await find(target.row.reference)).toEqual([target.row.reference]);
      expect(await find('zanele-search')).toEqual([]); // not an exact fragment
      expect(await find('zanele search-me')).toEqual([target.row.reference]);
      expect(await find(target.row.client_email.toUpperCase())).toEqual([
        target.row.reference,
      ]);
      expect(await find(target.row.client_phone.slice(-6))).toContain(
        target.row.reference,
      );
      expect(await find('%')).toEqual([]);
      expect(await find('_')).toEqual([]);
    });

    it('sorts and pages', async () => {
      const a = await insert();
      const b = await insert();
      const c = await insert();
      const refs = async (query: string) =>
        bodyOf<{ items: AdminBooking[] }>(
          await get(`/bookings?q=admin-test@example.com&${query}`),
        ).items.map((x) => x.reference);
      expect(await refs('sort=startAt')).toEqual([
        a.row.reference,
        b.row.reference,
        c.row.reference,
      ]);
      expect(await refs('sort=-startAt')).toEqual([
        c.row.reference,
        b.row.reference,
        a.row.reference,
      ]);
      expect(await refs('sort=startAt&pageSize=2&page=2')).toEqual([
        c.row.reference,
      ]);
      const paged = bodyOf<{ total: number; pageSize: number; page: number }>(
        await get('/bookings?q=admin-test@example.com&pageSize=2&page=2'),
      );
      expect(paged).toMatchObject({ total: 3, pageSize: 2, page: 2 });
    });

    it.each([
      ['status=nonsense'],
      ['from=2026-13-45'],
      ['proof=yes'],
      ['refund=yes'],
      ['sort=price'],
      ['page=0'],
      ['pageSize=101'],
      ['pageSize=abc'],
      ['unknown=1'],
    ])('rejects ?%s', async (query) => {
      const res = await get(`/bookings?${query}`);
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('detail (#63)', () => {
    it('shows the proofs, the notifications and reused proofs', async () => {
      const first = await insert();
      const second = await insert();
      const hash = sha256('same file');
      await addProof(first.row.id, hash);
      await addProof(second.row.id, hash);
      await db
        .insertInto('notifications')
        .values({
          booking_id: first.row.id,
          recipient: first.row.client_email,
          type: 'payment_instructions',
          status: 'sent',
          sent_at: new Date(),
        })
        .execute();

      const res = await get(`/bookings/${first.row.id}`);
      expect(res.status).toBe(200);
      const body = bodyOf<{
        booking: AdminBooking;
        proofs: Record<string, unknown>[];
        notifications: Record<string, unknown>[];
      }>(res);
      expect(body.booking.id).toBe(first.row.id);
      expect(body.proofs).toHaveLength(1);
      expect(body.proofs[0]).toMatchObject({
        originalFilename: 'proof.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1234,
        sha256: hash.toString('hex'),
        usedOnOtherBookings: [second.row.reference],
        status: 'received',
        rejectionReason: null,
        uploadedFromIp: '196.25.1.1',
        reviewedAt: null,
        fileDeletedAt: null,
      });
      expect(body.notifications).toEqual([
        {
          type: 'payment_instructions',
          recipient: first.row.client_email,
          status: 'sent',
          sentAt: expect.any(String) as string,
          error: null,
        },
      ]);
      expect(JSON.stringify(body)).not.toMatch(/token/i);
    });

    it('answers 404 for an unknown booking or something that is not an id', async () => {
      for (const id of ['00000000-0000-0000-0000-000000000000', 'not-an-id']) {
        const res = await get(`/bookings/${id}`);
        expect(res.status).toBe(404);
        expect(errorBody(res).code).toBe('NOT_FOUND');
      }
    });
  });

  describe('confirm payment (#64)', () => {
    it('confirms, records who, when and how much, and emails a fresh link', async () => {
      const { row, token } = await insert();
      const res = await post(`/bookings/${row.id}/confirm-payment`, {
        amountReceived: '325',
      });
      expect(res.status).toBe(200);
      const body = bodyOf<{
        booking: AdminBooking;
        emailSentTo: string | null;
      }>(res);
      expect(body.booking).toMatchObject({
        status: 'confirmed',
        paymentStatus: 'confirmed',
        amountReceived: '325.00',
        paymentVerifiedBy: admin.id,
      });
      expect(body.booking.paymentVerifiedAt).not.toBeNull();
      expect(body.emailSentTo).toBe(row.client_email);

      // The confirmation email carries a new link and the old one is dead
      expect(toClient(row)).toHaveLength(1);
      const email = toClient(row)[0];
      expect(email.subject).toMatch(/^You're booked! .*Soft Glam on /);
      expect(email.text).toContain('your deposit of R325 has been received');
      expect(email.text).toContain('Cancel by ');
      const newToken = TOKEN_IN_LINK.exec(email.text)?.[1] ?? '';
      expect(newToken).not.toBe(token);
      expect(await hashOf(row.id)).toEqual(sha256(newToken));
      expect(await hashOf(row.id)).not.toEqual(sha256(token));
      expect(JSON.stringify(body)).not.toContain(newToken);
    });

    it('records the notification as booking_confirmed', async () => {
      const { row } = await insert();
      await post(`/bookings/${row.id}/confirm-payment`, {
        amountReceived: '325.00',
      });
      const notification = await db
        .selectFrom('notifications')
        .selectAll()
        .where('booking_id', '=', row.id)
        .executeTakeFirstOrThrow();
      expect(notification).toMatchObject({
        type: 'booking_confirmed',
        status: 'sent',
      });
    });

    it('lets the owner record less than the deposit', async () => {
      const { row } = await insert();
      const res = await post(`/bookings/${row.id}/confirm-payment`, {
        amountReceived: '100.00',
      });
      expect(res.status).toBe(200);
      expect(bookingOf(res).amountReceived).toBe('100.00');
    });

    it('says deposits are not refundable when the settings say so', async () => {
      await db
        .updateTable('settings')
        .set({ deposit_refundable: false })
        .where('id', '=', 1)
        .execute();
      const { row } = await insert();
      await post(`/bookings/${row.id}/confirm-payment`, {
        amountReceived: '325.00',
      });
      expect(toClient(row)[0].text).toContain(
        "Please note that deposits aren't refundable.",
      );
    });

    it('stays confirmed when the email cannot be sent, and says so', async () => {
      provider.failWith = 'the mail server is down';
      const { row } = await insert();
      const res = await post(`/bookings/${row.id}/confirm-payment`, {
        amountReceived: '325.00',
      });
      expect(res.status).toBe(200);
      expect(
        bodyOf<{ emailSentTo: string | null }>(res).emailSentTo,
      ).toBeNull();
      expect((await statusOf(row.id)).status).toBe('confirmed');
    });

    it.each([
      [{ amountReceived: '0' }],
      [{ amountReceived: '0.00' }],
      [{ amountReceived: '-5' }],
      [{ amountReceived: 'abc' }],
      [{ amountReceived: '10.999' }],
      [{ amountReceived: 325 }],
      [{}],
      [{ amountReceived: '325', extra: true }],
    ])('rejects %j', async (payload) => {
      const { row } = await insert();
      const res = await post(`/bookings/${row.id}/confirm-payment`, payload);
      expect(res.status).toBe(400);
      expect((await statusOf(row.id)).status).toBe('pending');
    });

    it.each(['confirmed', 'cancelled', 'expired', 'completed'] as const)(
      'refuses a %s booking with 409',
      async (status) => {
        const { row } = await insert({ status });
        const res = await post(`/bookings/${row.id}/confirm-payment`, {
          amountReceived: '325.00',
        });
        expect(res.status).toBe(409);
        expect(errorBody(res).code).toBe('INVALID_STATUS_TRANSITION');
        expect(provider.sent).toHaveLength(0);
      },
    );

    it('answers 404 for an unknown booking', async () => {
      const res = await post(
        '/bookings/00000000-0000-0000-0000-000000000000/confirm-payment',
        { amountReceived: '325.00' },
      );
      expect(res.status).toBe(404);
    });
  });

  describe('extend the deadline (#65)', () => {
    it('moves the deadline of a Pending booking', async () => {
      const { row } = await insert();
      const later = new Date(Date.now() + 3 * 86_400_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      const res = await patch(`/bookings/${row.id}/deadline`, {
        depositDueAt: later,
      });
      expect(res.status).toBe(200);
      expect(bookingOf(res).depositDueAt).toBe(later);
    });

    it('rejects a deadline in the past or after the appointment starts', async () => {
      const { row } = await insert();
      const past = new Date(Date.now() - 60_000).toISOString();
      const afterStart = new Date(
        row.start_at.getTime() + 60_000,
      ).toISOString();
      for (const depositDueAt of [past, afterStart]) {
        const res = await patch(`/bookings/${row.id}/deadline`, {
          depositDueAt,
        });
        expect(res.status).toBe(400);
        expect(errorBody(res).details?.[0].field).toBe('depositDueAt');
      }
    });

    it('rejects something that is not a time', async () => {
      const { row } = await insert();
      const res = await patch(`/bookings/${row.id}/deadline`, {
        depositDueAt: 'tomorrow',
      });
      expect(res.status).toBe(400);
    });

    it('refuses a booking that is not Pending', async () => {
      const { row } = await insert({ status: 'confirmed' });
      const res = await patch(`/bookings/${row.id}/deadline`, {
        depositDueAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(res.status).toBe(409);
      expect(errorBody(res).code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('cancel, complete and no-show (#65)', () => {
    // Each call is an hour earlier than the last, so the bookings don't overlap
    let pastCalls = 0;
    const past = () => {
      pastCalls += 1;
      const start = new Date(Date.now() - pastCalls * 3 * 3_600_000);
      return {
        start_at: start,
        end_at: new Date(start.getTime() + 60_000),
        occupied_until: new Date(start.getTime() + 120_000),
      };
    };

    it('cancels a Pending booking, frees the slot and emails the client', async () => {
      const { row } = await insert();
      const res = await patch(`/bookings/${row.id}/status`, {
        status: 'cancelled',
      });
      expect(res.status).toBe(200);
      expect(bookingOf(res)).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'admin',
        refundDue: false,
        paymentStatus: 'cancelled',
      });
      expect(bookingOf(res).cancelledAt).not.toBeNull();
      expect((res.body as { emailSentTo: string | null }).emailSentTo).toBe(
        row.client_email,
      );

      const email = toClient(row)[0];
      expect(email.subject).toBe(
        `Your booking ${row.reference} has been cancelled`,
      );
      expect(email.text).toContain(
        "I'm sorry, but I've had to cancel your booking.",
      );
      expect(email.text).toContain(
        'No deposit had been confirmed for this booking.',
      );
      expect(email.text).not.toMatch(/\/booking\/[\w-]{43}/);

      // The slot is free again (BR-2): an overlapping booking can now be made
      await expect(
        db
          .insertInto('bookings')
          .values({
            service_id: service.id,
            client_name: 'Next client',
            client_email: 'next.admin-test@example.com',
            client_phone: '+27825550000',
            start_at: row.start_at,
            end_at: row.end_at,
            occupied_until: row.occupied_until,
            price_at_booking: '650.00',
            deposit_amount: '325.00',
            deposit_due_at: new Date(Date.now() + 86_400_000),
            status: 'pending',
          })
          .execute(),
      ).resolves.toBeDefined();
    });

    it('refuses refundDue on a Pending booking', async () => {
      const { row } = await insert();
      const res = await patch(`/bookings/${row.id}/status`, {
        status: 'cancelled',
        refundDue: true,
      });
      expect(res.status).toBe(400);
      expect((await statusOf(row.id)).status).toBe('pending');
    });

    it('makes the owner decide about the refund when cancelling a Confirmed booking', async () => {
      const { row } = await insert({ status: 'confirmed' });
      const res = await patch(`/bookings/${row.id}/status`, {
        status: 'cancelled',
      });
      expect(res.status).toBe(400);
      expect(errorBody(res).details?.[0].field).toBe('refundDue');
      expect((await statusOf(row.id)).status).toBe('confirmed');
    });

    it('marks a refund due and tells the client', async () => {
      const { row } = await insert({ status: 'confirmed' });
      const res = await patch(`/bookings/${row.id}/status`, {
        status: 'cancelled',
        refundDue: true,
      });
      expect(res.status).toBe(200);
      expect(bookingOf(res)).toMatchObject({
        status: 'cancelled',
        refundDue: true,
        refundedAt: null,
      });
      expect(toClient(row)[0].text).toContain(
        "Your deposit of R325 will be refunded. I'll be in touch to arrange it.",
      );
      const dashboard = bodyOf<{ refundsDue: number }>(await get('/dashboard'));
      expect(dashboard.refundsDue).toBeGreaterThanOrEqual(1);
    });

    it('cancels a Confirmed booking with no refund, and says nothing about one', async () => {
      const { row } = await insert({ status: 'confirmed' });
      const res = await patch(`/bookings/${row.id}/status`, {
        status: 'cancelled',
        refundDue: false,
      });
      expect(res.status).toBe(200);
      expect(bookingOf(res).refundDue).toBe(false);
      expect(toClient(row)[0].text).not.toMatch(/refund/i);
    });

    it('stays cancelled when the cancellation email cannot be sent', async () => {
      provider.failWith = 'the mail server is down';
      const { row } = await insert();
      const res = await patch(`/bookings/${row.id}/status`, {
        status: 'cancelled',
      });
      expect(res.status).toBe(200);
      expect(
        (res.body as { emailSentTo: string | null }).emailSentTo,
      ).toBeNull();
      expect((await statusOf(row.id)).status).toBe('cancelled');
    });

    it('marks a Confirmed booking Completed or No-show once it has started', async () => {
      const done = await insert({ status: 'confirmed', ...past() });
      const missed = await insert({ status: 'confirmed', ...past() });
      const completed = await patch(`/bookings/${done.row.id}/status`, {
        status: 'completed',
      });
      const noShow = await patch(`/bookings/${missed.row.id}/status`, {
        status: 'no_show',
      });
      expect(completed.status).toBe(200);
      expect(bookingOf(completed).status).toBe('completed');
      expect(noShow.status).toBe(200);
      expect(bookingOf(noShow).status).toBe('no_show');
    });

    it('will not mark an appointment that has not started', async () => {
      const { row } = await insert({ status: 'confirmed' });
      for (const status of ['completed', 'no_show']) {
        const res = await patch(`/bookings/${row.id}/status`, { status });
        expect(res.status).toBe(409);
        expect(errorBody(res).code).toBe('INVALID_STATUS_TRANSITION');
      }
      expect((await statusOf(row.id)).status).toBe('confirmed');
    });

    it.each([
      ['pending', 'completed'],
      ['pending', 'no_show'],
      ['completed', 'cancelled'],
      ['cancelled', 'cancelled'],
      ['expired', 'cancelled'],
      ['no_show', 'completed'],
    ] as const)('rejects %s → %s', async (from, to) => {
      const { row } = await insert({ status: from, ...past() });
      const res = await patch(`/bookings/${row.id}/status`, {
        status: to,
      });
      expect(res.status).toBe(409);
      expect(errorBody(res).code).toBe('INVALID_STATUS_TRANSITION');
      expect((await statusOf(row.id)).status).toBe(from);
    });

    it('does not accept other statuses or fields', async () => {
      const { row } = await insert();
      for (const payload of [
        { status: 'expired' },
        { status: 'confirmed' },
        { status: 'bogus' },
        {},
        { status: 'cancelled', refundDue: 'yes' },
        { status: 'cancelled', extra: 1 },
      ]) {
        const res = await patch(`/bookings/${row.id}/status`, payload);
        expect(res.status).toBe(400);
      }
    });

    it('refuses refundDue on completed and no-show', async () => {
      const { row } = await insert({ status: 'confirmed', ...past() });
      const res = await patch(`/bookings/${row.id}/status`, {
        status: 'completed',
        refundDue: false,
      });
      expect(res.status).toBe(400);
    });

    it('will not mark a refund due when there was no deposit', async () => {
      const { row } = await insert({
        status: 'confirmed',
        deposit_amount: '0.00',
        amount_received: null,
        payment_verified_at: null,
        payment_verified_by: null,
      });
      const res = await patch(`/bookings/${row.id}/status`, {
        status: 'cancelled',
        refundDue: true,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('refunds (#74)', () => {
    const paid = () => ({
      status: 'cancelled' as const,
      refund_due: true,
      amount_received: '325.00',
      payment_verified_at: new Date(),
      payment_verified_by: admin.id,
    });

    it('records a refund that was due, once', async () => {
      const { row } = await insert(paid());
      const before = bodyOf<{ refundsDue: number }>(await get('/dashboard'));
      const res = await post(`/bookings/${row.id}/refund`);
      expect(res.status).toBe(200);
      expect(bookingOf(res)).toMatchObject({ refundDue: true });
      expect(bookingOf(res).refundedAt).not.toBeNull();
      expect((await statusOf(row.id)).refunded_at).not.toBeNull();

      const after = bodyOf<{ refundsDue: number }>(await get('/dashboard'));
      expect(after.refundsDue).toBe(before.refundsDue - 1);

      const again = await post(`/bookings/${row.id}/refund`);
      expect(again.status).toBe(409);
      expect(errorBody(again).code).toBe('NO_REFUND_DUE');
    });

    it('refuses a booking with no refund due', async () => {
      const { row } = await insert({ status: 'confirmed' });
      const res = await post(`/bookings/${row.id}/refund`);
      expect(res.status).toBe(409);
      expect(errorBody(res).code).toBe('NO_REFUND_DUE');
      expect((await statusOf(row.id)).refunded_at).toBeNull();
    });

    it('takes an empty body but no fields', async () => {
      const { row } = await insert(paid());
      const bad = await post(`/bookings/${row.id}/refund`, { amount: '1.00' });
      expect(bad.status).toBe(400);
      const none = await http()
        .post(`/api/admin/bookings/${row.id}/refund`)
        .set('Cookie', admin.cookie);
      expect(none.status).toBe(200);
    });

    it('answers 404 for an unknown booking', async () => {
      const res = await post(
        '/bookings/00000000-0000-0000-0000-000000000000/refund',
      );
      expect(res.status).toBe(404);
    });

    it('lists only the refunds still to pay with ?refund=due', async () => {
      const owed = await insert(paid());
      const settled = await insert({ ...paid(), refunded_at: new Date() });
      await insert({ status: 'confirmed' });
      const res = await get('/bookings?refund=due&q=admin-test@example.com');
      const refs = bodyOf<{ items: AdminBooking[] }>(res).items.map(
        (b) => b.reference,
      );
      expect(refs).toEqual([owed.row.reference]);
      expect(refs).not.toContain(settled.row.reference);
    });
  });

  describe('a new booking link (#66)', () => {
    it('replaces the link and emails the new one', async () => {
      const { row, token } = await insert();
      const res = await post(`/bookings/${row.id}/booking-link`);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        bookingLinkIssuedAt: expect.any(String) as string,
        emailSentTo: row.client_email,
      });
      const email = toClient(row)[0];
      expect(email.subject).toBe(`Your new booking link for ${row.reference}`);
      const newToken = TOKEN_IN_LINK.exec(email.text)?.[1] ?? '';
      expect(newToken).not.toBe(token);
      expect(await hashOf(row.id)).toEqual(sha256(newToken));
      expect(await hashOf(row.id)).not.toEqual(sha256(token));
      expect(JSON.stringify(res.body)).not.toContain(newToken);
    });

    it('works for a Confirmed booking too', async () => {
      const { row } = await insert({ status: 'confirmed' });
      const res = await post(`/bookings/${row.id}/booking-link`);
      expect(res.status).toBe(202);
      expect(toClient(row)).toHaveLength(1);
    });

    it('says when the email could not be sent, but the link is still replaced', async () => {
      provider.failWith = 'the mail server is down';
      const { row, token } = await insert();
      const res = await post(`/bookings/${row.id}/booking-link`);
      expect(res.status).toBe(202);
      expect(
        (res.body as { emailSentTo: string | null }).emailSentTo,
      ).toBeNull();
      expect(await hashOf(row.id)).not.toEqual(sha256(token));
    });

    it.each(['cancelled', 'expired', 'completed'] as const)(
      'refuses a %s booking',
      async (status) => {
        const { row, token } = await insert({ status });
        const res = await post(`/bookings/${row.id}/booking-link`);
        expect(res.status).toBe(409);
        expect(errorBody(res).code).toBe('INVALID_STATUS_TRANSITION');
        expect(await hashOf(row.id)).toEqual(sha256(token));
      },
    );

    it('refuses once the appointment has started', async () => {
      const start = new Date(Date.now() - 3_600_000);
      const { row } = await insert({
        status: 'confirmed',
        start_at: start,
        end_at: new Date(start.getTime() + 60_000),
        occupied_until: new Date(start.getTime() + 120_000),
      });
      const res = await post(`/bookings/${row.id}/booking-link`);
      expect(res.status).toBe(409);
    });

    it('answers 404 for an unknown booking', async () => {
      const res = await post(
        '/bookings/00000000-0000-0000-0000-000000000000/booking-link',
      );
      expect(res.status).toBe(404);
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
