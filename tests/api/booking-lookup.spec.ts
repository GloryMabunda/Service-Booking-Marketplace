import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from '../../src/app.factory.js';
import { planBooking } from '../../src/bookings/booking-plan.js';
import {
  type BookingRecord,
  BookingsRepository,
  type NewBooking,
} from '../../src/bookings/bookings.repository.js';
import type { BookingLookup } from '../../src/bookings/booking-lookup.service.js';
import {
  RATE_LIMITER,
  type SlidingWindowLimiter,
} from '../../src/common/rate-limit.js';
import type { DB } from '../../src/database/database.types.js';
import { createTestDatabase } from '../helpers/database.js';
import { localAt, upcoming } from '../helpers/dates.js';
import { bodyOf, errorBody } from '../helpers/http.js';

// POST /api/bookings/:reference/lookup (#52, docs/api.md 4.4)
describe('Booking lookup', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let repository: BookingsRepository;
  let service: { id: string };
  const createdUsers: string[] = [];

  const PREFIX = 'Lookup test ';
  const TUESDAY = upcoming(2);
  const settings = {
    depositPercent: '50.00',
    depositHoldHours: 24,
    minNoticeHours: 24,
    bufferMinutes: 60,
  };

  beforeAll(async () => {
    db = createTestDatabase();
    app = await createApp<INestApplication<App>>({ logger: false });
    await app.init();
    repository = new BookingsRepository(db);
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
  });

  afterEach(async () => {
    await db
      .deleteFrom('payment_proofs')
      .where(
        'booking_id',
        'in',
        db
          .selectFrom('bookings')
          .select('id')
          .where('service_id', '=', service.id),
      )
      .execute();
    await db
      .deleteFrom('bookings')
      .where('service_id', '=', service.id)
      .execute();
  });

  afterAll(async () => {
    await db
      .deleteFrom('services')
      .where('name', 'like', `${PREFIX}%`)
      .execute();
    if (createdUsers.length) {
      await db.updateTable('settings').set({ updated_by: null }).execute();
      await db.deleteFrom('users').where('id', 'in', createdUsers).execute();
    }
    await app.close();
    await db.destroy();
  });

  async function makeBooking(
    time = '09:00',
    overrides: Partial<NewBooking> = {},
    date = TUESDAY,
    depositPercent = settings.depositPercent,
  ): Promise<BookingRecord> {
    return repository.insert({
      ...planBooking({
        service: { price: '650.00', durationMinutes: 90 },
        settings: { ...settings, depositPercent },
        startAt: localAt(date, time),
        now: new Date(),
      }),
      serviceId: service.id,
      clientName: 'Sarah Mokoena',
      clientEmail: 'sarah@example.com',
      clientPhone: '+27821234567',
      notes: null,
      ...overrides,
    });
  }

  const lookup = (reference: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/bookings/${encodeURIComponent(reference)}/lookup`)
      .send(body);

  async function adminId(): Promise<string> {
    const user = await db
      .insertInto('users')
      .values({
        email: `lookup-test-${Date.now()}@example.com`,
        password_hash: 'not-a-real-hash',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    createdUsers.push(user.id);
    return user.id;
  }

  describe('finding a booking', () => {
    it('shows the booking with its status and payment status, and never the link', async () => {
      const booking = await makeBooking();
      const res = await lookup(booking.reference, {
        email: 'sarah@example.com',
      }).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');

      const { booking: found, canResendBookingLink } =
        bodyOf<BookingLookup>(res);
      expect(found).toEqual({
        reference: booking.reference,
        status: 'pending',
        paymentStatus: 'awaiting_payment',
        service: { name: `${PREFIX}Soft Glam`, durationMinutes: 90 },
        startAt: localAt(TUESDAY, '09:00').toISOString().replace('.000Z', 'Z'),
        endAt: localAt(TUESDAY, '10:30').toISOString().replace('.000Z', 'Z'),
        timeZone: 'Africa/Johannesburg',
        price: '650.00',
        depositAmount: '325.00',
        depositDueAt: expect.stringMatching(/Z$/) as string,
        location: 'studio',
        appointmentAddress: null,
        travelFee: '0.00',
        proofs: [],
      });
      expect(canResendBookingLink).toBe(true);

      const text = res.text.toLowerCase();
      expect(text).not.toContain('token');
      expect(text).not.toContain('sarah@example.com'); // the email isn't echoed
      expect(text).not.toContain('+27821234567'); // nor the phone
    });

    it('ignores capitals and spaces in the email and capitals in the reference', async () => {
      const booking = await makeBooking();
      await lookup(booking.reference.toLowerCase(), {
        email: '  SARAH@Example.COM ',
      }).expect(200);
    });

    it('shows a Confirmed booking whose payment the owner verified', async () => {
      const booking = await makeBooking();
      await db
        .updateTable('bookings')
        .set({
          status: 'confirmed',
          amount_received: '325.00',
          payment_verified_at: new Date(),
          payment_verified_by: await adminId(),
        })
        .where('id', '=', booking.id)
        .execute();
      const res = await lookup(booking.reference, {
        email: 'sarah@example.com',
      }).expect(200);
      expect(bodyOf<BookingLookup>(res).booking).toMatchObject({
        status: 'confirmed',
        paymentStatus: 'confirmed',
      });
    });

    it('says not_required for a booking with no deposit', async () => {
      const booking = await makeBooking('09:00', {}, TUESDAY, '0.00');
      const res = await lookup(booking.reference, {
        email: 'sarah@example.com',
      }).expect(200);
      expect(bodyOf<BookingLookup>(res).booking).toMatchObject({
        status: 'confirmed',
        paymentStatus: 'not_required',
        depositAmount: '0.00',
        depositDueAt: null,
      });
    });

    it.each([
      ['expired', 'expired'],
      ['cancelled', 'cancelled'],
    ] as const)('shows a %s booking as %s', async (status, expected) => {
      const booking = await makeBooking();
      await db
        .updateTable('bookings')
        .set({
          status,
          ...(status === 'cancelled'
            ? { cancelled_at: new Date(), cancelled_by: 'client' as const }
            : {}),
        })
        .where('id', '=', booking.id)
        .execute();
      const res = await lookup(booking.reference, {
        email: 'sarah@example.com',
      }).expect(200);
      const body = bodyOf<BookingLookup>(res);
      expect(body.booking).toMatchObject({
        status,
        paymentStatus: expected,
      });
      expect(body.canResendBookingLink).toBe(false);
    });

    describe('proofs of payment (BR-14)', () => {
      const addProof = (
        bookingId: string,
        status: 'received' | 'accepted' | 'rejected',
        reason: string | null = null,
        key = Math.random().toString(36),
      ) =>
        db
          .insertInto('payment_proofs')
          .values({
            booking_id: bookingId,
            storage_key: `lookup-test-${key}`,
            original_filename: 'proof.pdf',
            content_type: 'application/pdf',
            size_bytes: 1000,
            sha256: Buffer.alloc(32, 1),
            uploaded_from_ip: '203.0.113.7',
            status,
            rejection_reason: reason,
            ...(status === 'received'
              ? {}
              : {
                  reviewed_at: new Date(),
                  reviewed_by: undefined as unknown as string,
                }),
          })
          .execute();

      it('shows proof_received while a proof waits for the owner', async () => {
        const booking = await makeBooking();
        await addProof(booking.id, 'received');
        const res = await lookup(booking.reference, {
          email: 'sarah@example.com',
        }).expect(200);
        const found = bodyOf<BookingLookup>(res).booking;
        expect(found.paymentStatus).toBe('proof_received');
        expect(found.proofs).toEqual([
          {
            uploadedAt: expect.stringMatching(/Z$/) as string,
            status: 'received',
            rejectionReason: null,
          },
        ]);
      });

      it('shows proof_rejected, with the reason, when every proof was rejected', async () => {
        const booking = await makeBooking();
        const reviewer = await adminId();
        await db
          .insertInto('payment_proofs')
          .values({
            booking_id: booking.id,
            storage_key: 'lookup-test-rejected',
            original_filename: 'proof.pdf',
            content_type: 'application/pdf',
            size_bytes: 1000,
            sha256: Buffer.alloc(32, 2),
            uploaded_from_ip: '203.0.113.7',
            status: 'rejected',
            rejection_reason: 'The amount does not match the deposit.',
            reviewed_at: new Date(),
            reviewed_by: reviewer,
          })
          .execute();
        const res = await lookup(booking.reference, {
          email: 'sarah@example.com',
        }).expect(200);
        const found = bodyOf<BookingLookup>(res).booking;
        expect(found.paymentStatus).toBe('proof_rejected');
        expect(found.proofs[0]).toMatchObject({
          status: 'rejected',
          rejectionReason: 'The amount does not match the deposit.',
        });
      });
    });

    describe('canResendBookingLink', () => {
      it('is true while Pending or Confirmed and the appointment has not started', async () => {
        const booking = await makeBooking();
        const res = await lookup(booking.reference, {
          email: 'sarah@example.com',
        }).expect(200);
        expect(bodyOf<BookingLookup>(res).canResendBookingLink).toBe(true);
      });

      it('is false once the appointment has started', async () => {
        const booking = await makeBooking();
        await db
          .updateTable('bookings')
          .set({
            start_at: new Date(Date.now() - 3_600_000),
            end_at: new Date(Date.now() + 1_800_000),
            occupied_from: null,
            occupied_until: new Date(Date.now() + 5_400_000),
          })
          .where('id', '=', booking.id)
          .execute();
        const res = await lookup(booking.reference, {
          email: 'sarah@example.com',
        }).expect(200);
        expect(bodyOf<BookingLookup>(res).canResendBookingLink).toBe(false);
      });
    });
  });

  describe('no enumeration: one answer for everything that is not a match', () => {
    it('answers a wrong email, a wrong reference and a malformed reference identically', async () => {
      const booking = await makeBooking();
      const wrongEmail = await lookup(booking.reference, {
        email: 'someone-else@example.com',
      }).expect(404);
      const wrongReference = await lookup('BK-999999', {
        email: 'sarah@example.com',
      }).expect(404);
      const malformed = await lookup('not-a-reference', {
        email: 'sarah@example.com',
      }).expect(404);

      expect(errorBody(wrongEmail)).toEqual({
        statusCode: 404,
        code: 'BOOKING_NOT_FOUND',
        message:
          "We couldn't find a booking with that reference and email. Check both and try again.",
        details: null,
      });
      expect(wrongReference.body).toEqual(wrongEmail.body);
      expect(malformed.body).toEqual(wrongEmail.body);
      for (const res of [wrongReference, malformed]) {
        expect(res.status).toBe(wrongEmail.status);
        expect(res.headers['content-type']).toBe(
          wrongEmail.headers['content-type'],
        );
        expect(res.headers['cache-control']).toBe(
          wrongEmail.headers['cache-control'],
        );
      }
    });

    it('does not reveal an email that belongs to another booking', async () => {
      const first = await makeBooking('09:00');
      await makeBooking('12:00', { clientEmail: 'other@example.com' });
      const res = await lookup(first.reference, {
        email: 'other@example.com',
      }).expect(404);
      expect(errorBody(res).code).toBe('BOOKING_NOT_FOUND');
    });
  });

  describe('the request', () => {
    it('needs an email, in the body, and rejects anything else', async () => {
      const booking = await makeBooking();
      const missing = await lookup(booking.reference, {}).expect(400);
      expect(errorBody(missing).details).toEqual([
        { field: 'email', message: 'Enter the email you used to book.' },
      ]);
      const invalid = await lookup(booking.reference, {
        email: 'nope',
      }).expect(400);
      expect(errorBody(invalid).details).toEqual([
        { field: 'email', message: 'Enter a valid email address.' },
      ]);
      await lookup(booking.reference, {
        email: 'sarah@example.com',
        extra: 1,
      }).expect(400);
    });

    it('has no GET form, so the email can never be put in a URL', async () => {
      const booking = await makeBooking();
      await request(app.getHttpServer())
        .get(`/api/bookings/${booking.reference}/lookup`)
        .query({ email: 'sarah@example.com' })
        .expect(404);
    });
  });

  describe('rate limit', () => {
    it('allows 10 lookups per 15 minutes per IP address, then answers 429', async () => {
      for (let i = 0; i < 10; i++) {
        await lookup('BK-000001', { email: 'nobody@example.com' }).expect(404);
      }
      const res = await lookup('BK-000001', {
        email: 'nobody@example.com',
      }).expect(429);
      expect(errorBody(res).code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(850);
      expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(900);
      expect(res.headers['ratelimit-limit']).toBe('10');
    });
  });
});
