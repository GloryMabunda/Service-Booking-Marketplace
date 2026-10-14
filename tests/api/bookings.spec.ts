import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Kysely, Selectable } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../../src/app.factory.js';
import { AppModule } from '../../src/app.module.js';
import {
  BOOKING_NOTIFIER,
  type BookingNotifier,
} from '../../src/bookings/booking-notifier.js';
import type { BookingRecord } from '../../src/bookings/bookings.repository.js';
import type { CreatedBooking } from '../../src/bookings/bookings.service.js';
import {
  RATE_LIMITER,
  type SlidingWindowLimiter,
} from '../../src/common/rate-limit.js';
import type { DB } from '../../src/database/database.types.js';
import { addDays } from '../../src/availability/time-zone.js';
import { createTestDatabase } from '../helpers/database.js';
import { localAt, upcoming } from '../helpers/dates.js';
import { bodyOf, errorBody } from '../helpers/http.js';

// POST /api/bookings: creating a booking (#45), its link token (#47), the
// limits (#48) and what happens when requests arrive together (#53).

// Stands in for the email sender (M5), and keeps what it was given
class RecordingNotifier implements BookingNotifier {
  calls: { booking: BookingRecord; token: string }[] = [];
  result = true;
  fail = false;
  bookingCreated(booking: BookingRecord, token: string): Promise<boolean> {
    this.calls.push({ booking, token });
    if (this.fail) return Promise.reject(new Error('the mail server is down'));
    return Promise.resolve(this.result);
  }
  bookingLinkReissued(): Promise<boolean> {
    return Promise.resolve(this.result);
  }
  bookingExpired(): Promise<void> {
    return Promise.resolve();
  }
  bookingConfirmed(): Promise<boolean> {
    return Promise.resolve(this.result);
  }
  bookingCancelled(): Promise<boolean> {
    return Promise.resolve(this.result);
  }
  proofRejected(): Promise<boolean> {
    return Promise.resolve(this.result);
  }
  proofUploaded(): Promise<void> {
    return Promise.resolve();
  }
  clientCancelled(): Promise<void> {
    return Promise.resolve();
  }
}

const PREFIX = 'Booking test ';
const TUESDAY = upcoming(2);
const REAL_BANKING = {
  accountName: 'Make Up by Glory',
  bank: 'Example Bank',
  accountNumber: '1234567890',
  branchCode: '250655',
  accountType: 'Cheque',
};

// A distinct, valid client for each number
const client = (n: number) => ({
  clientName: `Client ${n}`,
  clientEmail: `client${n}@example.com`,
  clientPhone: `082 555 ${String(1000 + n)}`,
});

describe('Bookings API', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let notifier: RecordingNotifier;
  let service: { id: string };
  let originalSettings: Selectable<DB['settings']>;

  beforeAll(async () => {
    db = createTestDatabase();
    originalSettings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();
    // The seed leaves the banking details as placeholders; real ones let a
    // booking that needs a deposit go ahead.
    await db
      .updateTable('settings')
      .set({ banking_details: JSON.stringify(REAL_BANKING) })
      .where('id', '=', 1)
      .execute();
    notifier = new RecordingNotifier();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BOOKING_NOTIFIER)
      .useValue(notifier)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
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
    notifier.calls = [];
    notifier.result = true;
    notifier.fail = false;
  });

  afterEach(async () => {
    await db
      .deleteFrom('bookings')
      .where('service_id', '=', service.id)
      .execute();
    await db
      .updateTable('settings')
      .set({
        deposit_percent: originalSettings.deposit_percent,
        banking_details: JSON.stringify(REAL_BANKING),
      })
      .where('id', '=', 1)
      .execute();
  });

  afterAll(async () => {
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
    await app.close();
    await db.destroy();
  });

  const post = (body: object) =>
    request(app.getHttpServer()).post('/api/bookings').send(body);
  const bookingBody = (
    time = '09:00',
    n = 1,
    date = TUESDAY,
    extra: object = {},
  ) => ({
    serviceId: service.id,
    startAt: localAt(date, time).toISOString(),
    ...client(n),
    ...extra,
  });
  const book = (time = '09:00', n = 1, date = TUESDAY, extra: object = {}) =>
    post(bookingBody(time, n, date, extra));
  const rows = () =>
    db
      .selectFrom('bookings')
      .selectAll()
      .where('service_id', '=', service.id)
      .orderBy('start_at')
      .execute();
  const holding = async () =>
    (await rows()).filter(
      (r) => r.status === 'pending' || r.status === 'confirmed',
    );

  describe('creating a booking (#45)', () => {
    it('creates a Pending booking and answers with the details in docs/api.md 4.3', async () => {
      const before = Date.now();
      const res = await book('09:00', 1, TUESDAY, {
        notes: 'Birthday makeup',
      }).expect(201);
      expect(res.headers['cache-control']).toBe('no-store');

      const { booking, emailSentTo } = bodyOf<CreatedBooking>(res);
      expect(booking).toMatchObject({
        status: 'pending',
        service: { name: `${PREFIX}Soft Glam`, durationMinutes: 90 },
        startAt: localAt(TUESDAY, '09:00').toISOString().replace('.000Z', 'Z'),
        endAt: localAt(TUESDAY, '10:30').toISOString().replace('.000Z', 'Z'),
        timeZone: 'Africa/Johannesburg',
        price: '650.00',
        depositAmount: '325.00',
      });
      expect(booking.reference).toMatch(/^BK-\d{6,}$/);
      // A week away: the deposit is due 24 hours (the hold) after booking
      const due = new Date(booking.depositDueAt as string).getTime();
      expect(Math.abs(due - (before + 24 * 3_600_000))).toBeLessThan(10_000);
      expect(emailSentTo).toBe('client1@example.com');
    });

    it('saves the booking with the client tidied and the price and deposit as they were', async () => {
      await book('09:00', 1, TUESDAY, {
        clientName: '  Sarah Mokoena ',
        clientEmail: ' Sarah@Example.com ',
        clientPhone: '082 123 4567',
        notes: ' Birthday makeup ',
      }).expect(201);
      const [row] = await rows();
      expect(row).toMatchObject({
        client_name: 'Sarah Mokoena',
        client_email: 'sarah@example.com',
        client_phone: '+27821234567',
        notes: 'Birthday makeup',
        status: 'pending',
        price_at_booking: '650.00',
        deposit_amount: '325.00',
      });
      expect(
        new Date(row.end_at).getTime() - new Date(row.start_at).getTime(),
      ).toBe(90 * 60_000);
      expect(
        new Date(row.occupied_until).getTime() - new Date(row.end_at).getTime(),
      ).toBe(60 * 60_000);
    });

    it('is Confirmed straight away, with no deadline, when there is no deposit (BR-3)', async () => {
      await db
        .updateTable('settings')
        .set({ deposit_percent: '0' })
        .where('id', '=', 1)
        .execute();
      const res = await book().expect(201);
      expect(bodyOf<CreatedBooking>(res).booking).toMatchObject({
        status: 'confirmed',
        depositAmount: '0.00',
        depositDueAt: null,
      });
    });

    it('lists every problem with the request', async () => {
      const res = await post({
        clientEmail: 'nope',
        clientPhone: '12345',
      }).expect(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
      expect(errorBody(res).details).toEqual([
        { field: 'serviceId', message: 'Choose a service.' },
        { field: 'startAt', message: 'Choose a date and time.' },
        { field: 'clientName', message: 'Enter your name.' },
        { field: 'clientEmail', message: 'Enter a valid email address.' },
        {
          field: 'clientPhone',
          message: 'Enter a South African phone number.',
        },
      ]);
      expect(await rows()).toHaveLength(0);
    });

    it('rejects unknown fields: the client cannot choose the status or the price', async () => {
      const res = await book('09:00', 1, TUESDAY, {
        status: 'confirmed',
        priceAtBooking: '1.00',
      }).expect(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
      expect(await rows()).toHaveLength(0);
    });

    it('refuses an unknown or inactive service with 400 SERVICE_UNAVAILABLE (BR-5)', async () => {
      const unknown = await book('09:00', 1, TUESDAY, {
        serviceId: '5b0d3c1e-0000-4000-8000-0000000000ff',
      }).expect(400);
      expect(errorBody(unknown).code).toBe('SERVICE_UNAVAILABLE');

      const inactive = await db
        .insertInto('services')
        .values({
          name: `${PREFIX}Hidden`,
          price: '100.00',
          duration_minutes: 60,
          is_active: false,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const res = await book('09:00', 1, TUESDAY, {
        serviceId: inactive.id,
      }).expect(400);
      expect(errorBody(res).code).toBe('SERVICE_UNAVAILABLE');
      expect(await rows()).toHaveLength(0);
    });

    describe('re-checks the slot with the same rules that offered it', () => {
      it.each([
        ['a time not on the slot interval', '09:30', TUESDAY],
        ['a time after the last start of the day', '16:00', TUESDAY],
        ['a time before opening', '08:00', TUESDAY],
        ['a day off (Sunday)', '10:00', upcoming(7)],
      ])('refuses %s with 409 SLOT_UNAVAILABLE', async (_label, time, date) => {
        const res = await book(time, 1, date).expect(409);
        expect(errorBody(res)).toEqual({
          statusCode: 409,
          code: 'SLOT_UNAVAILABLE',
          message:
            'That time is no longer available. Please choose another time.',
          details: null,
        });
        expect(await rows()).toHaveLength(0);
      });

      it('refuses a time that is too soon (inside the minimum notice)', async () => {
        const soon = new Date(Date.now() + 3_600_000).toISOString();
        const res = await post({ ...bookingBody(), startAt: soon }).expect(409);
        expect(errorBody(res).code).toBe('SLOT_UNAVAILABLE');
      });

      it('refuses a time beyond the advance window', async () => {
        const far = localAt(addDays(TUESDAY, 200), '09:00').toISOString();
        await post({ ...bookingBody(), startAt: far }).expect(409);
      });

      it('refuses a time that is blocked', async () => {
        await db
          .insertInto('blocked_times')
          .values({
            start_at: localAt(TUESDAY, '08:00'),
            end_at: localAt(TUESDAY, '18:00'),
          })
          .execute();
        try {
          const res = await book().expect(409);
          expect(errorBody(res).code).toBe('SLOT_UNAVAILABLE');
        } finally {
          await db.deleteFrom('blocked_times').execute();
        }
      });

      it('refuses a time already booked, and one that falls in its buffer', async () => {
        await book('09:00', 1).expect(201);
        await book('09:00', 2).expect(409); // the same time
        await book('10:00', 3).expect(409); // inside the appointment
        await book('11:00', 4).expect(409); // inside the buffer (to 11:30)
        await book('12:00', 5).expect(201); // free again
        expect(await holding()).toHaveLength(2);
      });

      it('frees the slot again when a booking is cancelled', async () => {
        await book('09:00', 1).expect(201);
        await db
          .updateTable('bookings')
          .set({
            status: 'cancelled',
            cancelled_at: new Date(),
            cancelled_by: 'client',
          })
          .where('service_id', '=', service.id)
          .execute();
        await book('09:00', 2).expect(201);
      });
    });

    describe('payment details (#28, #45)', () => {
      it('refuses a booking that needs a deposit while the banking details are still placeholders', async () => {
        const placeholder = 'Not set yet';
        await db
          .updateTable('settings')
          .set({
            banking_details: JSON.stringify({
              accountName: placeholder,
              bank: placeholder,
              accountNumber: placeholder,
              branchCode: placeholder,
              accountType: placeholder,
            }),
          })
          .where('id', '=', 1)
          .execute();
        const res = await book().expect(503);
        expect(errorBody(res)).toEqual({
          statusCode: 503,
          code: 'BOOKING_NOT_READY',
          message: "Online booking isn't ready yet. Please contact us to book.",
          details: null,
        });
        expect(await rows()).toHaveLength(0);
      });

      it('still takes a booking that needs no deposit, since nobody has to pay', async () => {
        await db
          .updateTable('settings')
          .set({
            deposit_percent: '0',
            banking_details: JSON.stringify({
              ...REAL_BANKING,
              bank: 'Not set yet',
            }),
          })
          .where('id', '=', 1)
          .execute();
        await book().expect(201);
      });
    });

    describe('the email (spec section 7)', () => {
      it('says which address it went to when it was sent', async () => {
        const res = await book().expect(201);
        expect(bodyOf<CreatedBooking>(res).emailSentTo).toBe(
          'client1@example.com',
        );
        expect(notifier.calls).toHaveLength(1);
        expect(notifier.calls[0].booking.reference).toBe(
          bodyOf<CreatedBooking>(res).booking.reference,
        );
      });

      it('says null when no email could be sent, and the booking is still saved', async () => {
        notifier.result = false;
        const res = await book().expect(201);
        expect(bodyOf<CreatedBooking>(res).emailSentTo).toBeNull();
        expect(await rows()).toHaveLength(1);
      });

      it('never loses or blocks the booking when the email sender fails', async () => {
        notifier.fail = true;
        const res = await book().expect(201);
        expect(bodyOf<CreatedBooking>(res)).toMatchObject({
          emailSentTo: null,
        });
        expect(await rows()).toHaveLength(1);
      });
    });
  });

  describe('the booking link token (BR-15, #47)', () => {
    it('is handed to the email sender only, and its hash is the only thing stored', async () => {
      const res = await book().expect(201);
      const [call] = notifier.calls;

      expect(call.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes
      const [row] = await rows();
      const stored = row.booking_token_hash as Buffer;
      expect(stored).toHaveLength(32);
      expect(
        stored.equals(createHash('sha256').update(call.token).digest()),
      ).toBe(true);
      expect(row.booking_token_created_at).not.toBeNull();

      // The token is nowhere in the database row...
      expect(JSON.stringify(row)).not.toContain(call.token);
      // ...and never in the response
      expect(res.text).not.toContain(call.token);
    });

    it('is never returned: no field of the response is, or hints at, a token or a link', async () => {
      const res = await book().expect(201);
      const text = res.text.toLowerCase();
      expect(text).not.toContain('token');
      expect(text).not.toContain('/booking/');
      expect(Object.keys(bodyOf<CreatedBooking>(res).booking).sort()).toEqual([
        'depositAmount',
        'depositDueAt',
        'endAt',
        'price',
        'reference',
        'service',
        'startAt',
        'status',
        'timeZone',
      ]);
    });

    it('is different for every booking', async () => {
      await book('09:00', 1).expect(201);
      await book('12:00', 2).expect(201);
      expect(new Set(notifier.calls.map((c) => c.token)).size).toBe(2);
    });
  });

  describe('limits (#48, BR-11)', () => {
    it('refuses a third Pending booking for the same email with 409 PENDING_LIMIT_REACHED', async () => {
      await book('09:00', 1, TUESDAY, { clientPhone: '082 555 0001' }).expect(
        201,
      );
      await book('12:00', 1, TUESDAY, { clientPhone: '082 555 0002' }).expect(
        201,
      );
      const res = await book('15:00', 1, TUESDAY, {
        clientPhone: '082 555 0003',
      }).expect(409);
      expect(errorBody(res)).toEqual({
        statusCode: 409,
        code: 'PENDING_LIMIT_REACHED',
        message:
          'You already have 2 bookings waiting for a deposit. Please pay for those, or wait for them to expire, before booking again.',
        details: null,
      });
      expect(await holding()).toHaveLength(2);
    });

    it('refuses a third Pending booking for the same phone number, whatever the email', async () => {
      await book('09:00', 1, TUESDAY, { clientEmail: 'a@example.com' }).expect(
        201,
      );
      await book('12:00', 1, TUESDAY, { clientEmail: 'b@example.com' }).expect(
        201,
      );
      await book('15:00', 1, TUESDAY, { clientEmail: 'c@example.com' }).expect(
        409,
      );
    });

    it('sees through capitals and the way a phone number is written', async () => {
      await book('09:00', 1, TUESDAY, {
        clientEmail: 'Sarah@Example.com',
        clientPhone: '082 111 2222',
      }).expect(201);
      await book('12:00', 1, TUESDAY, {
        clientEmail: ' sarah@EXAMPLE.com',
        clientPhone: '0821112222',
      }).expect(201);
      const res = await book('15:00', 1, TUESDAY, {
        clientEmail: 'SARAH@example.com',
        clientPhone: '+27 82 111 2222',
      }).expect(409);
      expect(errorBody(res).code).toBe('PENDING_LIMIT_REACHED');
    });

    it('does not count Confirmed, Cancelled or Expired bookings, or another person', async () => {
      await book('09:00', 1, TUESDAY, { clientPhone: '082 555 0001' }).expect(
        201,
      );
      await book('12:00', 1, TUESDAY, { clientPhone: '082 555 0002' }).expect(
        201,
      );
      await book('15:00', 2).expect(201); // someone else is not limited

      // Free the two of the first client: one Confirmed (not Pending), one Cancelled
      const [first, second] = await rows();
      await db
        .updateTable('bookings')
        .set({
          status: 'cancelled',
          cancelled_at: new Date(),
          cancelled_by: 'client',
        })
        .where('id', '=', first.id)
        .execute();
      const next = addDays(TUESDAY, 1);
      await book('09:00', 1, next, { clientPhone: '082 555 0004' }).expect(201); // one Pending left + this = 2
      await book('12:00', 1, next, { clientPhone: '082 555 0005' }).expect(409); // that would be a third
      void second;
    });
  });

  describe('rate limit (#48)', () => {
    it('allows 10 booking requests an hour per IP address, then answers 429 with Retry-After', async () => {
      for (let i = 0; i < 10; i++) await post({}).expect(400); // every request counts, valid or not
      const res = await post({}).expect(429);
      expect(errorBody(res).code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(3500);
      expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(3600);
      expect(res.headers['ratelimit-limit']).toBe('10');
      expect(res.headers['ratelimit-remaining']).toBe('0');
    });

    it('tells every response how many requests are left', async () => {
      const res = await post({}).expect(400);
      expect(res.headers['ratelimit-limit']).toBe('10');
      expect(res.headers['ratelimit-remaining']).toBe('9');
    });
  });

  // Requests arriving at the same moment (BR-2, #53): the database, not the
  // code, decides, so exactly one booking wins.
  describe('requests arriving together (#53)', () => {
    const statuses = (responses: request.Response[]) =>
      responses.map((r) => r.status).sort();

    it('gives exactly one booking, and 409 to every other request, for the same slot', async () => {
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, i) => book('09:00', i + 1)),
      );
      expect(statuses(responses)).toEqual([
        201, 409, 409, 409, 409, 409, 409, 409,
      ]);
      for (const res of responses.filter((r) => r.status === 409)) {
        expect(errorBody(res).code).toBe('SLOT_UNAVAILABLE');
      }
      expect(await holding()).toHaveLength(1);
      // Only the winner was told by email
      expect(notifier.calls).toHaveLength(1);
    });

    it('gives exactly one booking for overlapping slots: 09:00 against 10:00', async () => {
      // Both are offered when the requests start; the buffer after 09:00 runs to 11:30.
      const responses = await Promise.all([book('09:00', 1), book('10:00', 2)]);
      expect(statuses(responses)).toEqual([201, 409]);
      expect(await holding()).toHaveLength(1);
    });

    it('lets different slots that do not overlap all succeed together', async () => {
      const responses = await Promise.all([
        book('09:00', 1),
        book('12:00', 2),
        book('15:00', 3),
      ]);
      expect(statuses(responses)).toEqual([201, 201, 201]);
      expect(await holding()).toHaveLength(3);
    });

    it('lets one client have at most 2 Pending bookings when 5 requests arrive together', async () => {
      // Five different days, the same email: only the advisory lock stops all
      // of them seeing "no Pending bookings yet".
      const days = [0, 1, 2, 3, 4].map((n) => addDays(TUESDAY, n));
      const responses = await Promise.all(
        days.map((day, i) =>
          book('09:00', 1, day, { clientPhone: `082 555 ${2000 + i}` }),
        ),
      );
      expect(statuses(responses)).toEqual([201, 201, 409, 409, 409]);
      for (const res of responses.filter((r) => r.status === 409)) {
        expect(errorBody(res).code).toBe('PENDING_LIMIT_REACHED');
      }
      expect(await holding()).toHaveLength(2);
    });

    it('keeps the limit for one phone number across different emails arriving together', async () => {
      const days = [0, 1, 2, 3].map((n) => addDays(TUESDAY, n));
      const responses = await Promise.all(
        days.map((day, i) =>
          book('09:00', 1, day, { clientEmail: `phone-test${i}@example.com` }),
        ),
      );
      expect(statuses(responses)).toEqual([201, 201, 409, 409]);
      expect(await holding()).toHaveLength(2);
    });

    it('never deadlocks or fails with a server error when contacts overlap in different ways', async () => {
      // A and B share a phone; B and C share an email; C and D share a phone...
      const days = [0, 1, 2, 3, 4, 5].map((n) => addDays(TUESDAY, n));
      const combos: [string, string][] = [
        ['a@example.com', '082 777 0001'],
        ['b@example.com', '082 777 0001'],
        ['b@example.com', '082 777 0002'],
        ['c@example.com', '082 777 0002'],
        ['c@example.com', '082 777 0003'],
        ['a@example.com', '082 777 0003'],
      ];
      const responses = await Promise.all(
        combos.map(([email, phone], i) =>
          book('09:00', 1, days[i], { clientEmail: email, clientPhone: phone }),
        ),
      );
      for (const res of responses) expect([201, 409]).toContain(res.status);
      // Nobody has more than 2 Pending bookings
      const perEmail = new Map<string, number>();
      for (const row of await holding()) {
        perEmail.set(
          row.client_email,
          (perEmail.get(row.client_email) ?? 0) + 1,
        );
      }
      for (const count of perEmail.values())
        expect(count).toBeLessThanOrEqual(2);
    });
  });
});
