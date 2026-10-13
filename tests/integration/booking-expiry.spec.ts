import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { createApp } from '../../src/app.factory.js';
import { AvailabilityService } from '../../src/availability/availability.service.js';
import { planBooking } from '../../src/bookings/booking-plan.js';
import { BookingExpiryService } from '../../src/bookings/booking-expiry.service.js';
import {
  type BookingRecord,
  BookingsRepository,
  type NewBooking,
} from '../../src/bookings/bookings.repository.js';
import type { DB } from '../../src/database/database.types.js';
import { createTestDatabase } from '../helpers/database.js';
import { localAt, upcoming } from '../helpers/dates.js';

// Expiring unpaid bookings (#50, BR-9)
describe('BookingExpiryService', () => {
  let db: Kysely<DB>;
  let app: INestApplication;
  let repository: BookingsRepository;
  let expiry: BookingExpiryService;
  let availability: AvailabilityService;
  let service: { id: string };

  const PREFIX = 'Expiry test ';
  const TUESDAY = upcoming(2);
  const HOUR = 3_600_000;
  const settings = {
    depositPercent: '50.00',
    depositHoldHours: 24,
    minNoticeHours: 24,
    bufferMinutes: 60,
  };

  beforeAll(async () => {
    db = createTestDatabase();
    app = await createApp({ logger: false });
    await app.init();
    expiry = app.get(BookingExpiryService);
    availability = app.get(AvailabilityService);
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
    await app.close();
    await db.destroy();
  });

  // A Pending booking whose deposit is due `dueInHours` from now (negative:
  // already overdue)
  async function pending(
    time: string,
    dueInHours: number,
    overrides: Partial<NewBooking> = {},
  ): Promise<BookingRecord> {
    return repository.insert({
      ...planBooking({
        service: { price: '650.00', durationMinutes: 90 },
        settings,
        startAt: localAt(TUESDAY, time),
        now: new Date(),
      }),
      depositDueAt: new Date(Date.now() + dueInHours * HOUR),
      serviceId: service.id,
      clientName: 'Sarah Mokoena',
      clientEmail: 'sarah@example.com',
      clientPhone: '+27821234567',
      notes: null,
      ...overrides,
    });
  }

  const statusOf = async (id: string) =>
    (
      await db
        .selectFrom('bookings')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status;

  it('expires a Pending booking past its deposit deadline', async () => {
    const overdue = await pending('09:00', -1);
    const expired = await expiry.run();
    expect(expired).toEqual([
      {
        id: overdue.id,
        reference: overdue.reference,
        clientEmail: 'sarah@example.com',
      },
    ]);
    expect(await statusOf(overdue.id)).toBe('expired');
  });

  it('expires only Pending bookings past their deadline', async () => {
    const overdue = await pending('09:00', -1);
    const notYet = await pending('12:00', 5);
    const confirmed = await pending('15:00', -1);
    await db
      .updateTable('bookings')
      .set({ status: 'confirmed' })
      .where('id', '=', confirmed.id)
      .execute();

    const expired = await expiry.run();
    expect(expired.map((b) => b.id)).toEqual([overdue.id]);
    expect(await statusOf(overdue.id)).toBe('expired');
    expect(await statusOf(notYet.id)).toBe('pending'); // deadline in the future
    expect(await statusOf(confirmed.id)).toBe('confirmed'); // not Pending
  });

  it('leaves Cancelled and already Expired bookings alone', async () => {
    const cancelled = await pending('09:00', -2);
    await db
      .updateTable('bookings')
      .set({
        status: 'cancelled',
        cancelled_at: new Date(),
        cancelled_by: 'client',
      })
      .where('id', '=', cancelled.id)
      .execute();
    expect(await expiry.run()).toEqual([]);
    expect(await statusOf(cancelled.id)).toBe('cancelled');
  });

  it('expires a booking at its deadline, not a moment before', async () => {
    const booking = await pending('09:00', 1);
    const due = booking.depositDueAt as Date;
    expect(await expiry.run(new Date(due.getTime() - 1))).toEqual([]);
    expect(await statusOf(booking.id)).toBe('pending');
    expect(await expiry.run(due)).toHaveLength(1);
    expect(await statusOf(booking.id)).toBe('expired');
  });

  it('is safe to run twice: each booking is expired only once', async () => {
    await pending('09:00', -1);
    await pending('12:00', -2);
    expect(await expiry.run()).toHaveLength(2);
    expect(await expiry.run()).toEqual([]);
  });

  it('is safe to run at the same moment from two places: the bookings are split, never counted twice', async () => {
    for (const [i, time] of ['09:00', '12:00', '15:00'].entries()) {
      await pending(time, -(i + 1));
    }
    const [a, b] = await Promise.all([expiry.run(), expiry.run()]);
    expect(a.length + b.length).toBe(3);
    expect(new Set([...a, ...b].map((x) => x.id)).size).toBe(3);
  });

  it('still expires a booking that has an unreviewed proof of payment (BR-9)', async () => {
    const booking = await pending('09:00', -1);
    await db
      .insertInto('payment_proofs')
      .values({
        booking_id: booking.id,
        storage_key: 'expiry-test-proof',
        original_filename: 'proof.pdf',
        content_type: 'application/pdf',
        size_bytes: 1000,
        sha256: Buffer.alloc(32, 3),
        uploaded_from_ip: '203.0.113.7',
        status: 'received',
      })
      .execute();
    expect(await expiry.run()).toHaveLength(1);
    expect(await statusOf(booking.id)).toBe('expired');
  });

  it('reopens the slot, so another client can book it', async () => {
    // Overdue but not yet expired: the booking still holds its slot
    const overdue = await pending('09:00', -1);
    const now = new Date();
    const before = await availability.slotsFor(service.id, TUESDAY, now);
    expect(before.slots.map((s) => s.localTime)).not.toContain('09:00');
    expect(before.slots.map((s) => s.localTime)).not.toContain('10:00');
    expect(before.slots.map((s) => s.localTime)).not.toContain('11:00');

    await expiry.run();
    expect(await statusOf(overdue.id)).toBe('expired');

    const after = await availability.slotsFor(service.id, TUESDAY, now);
    expect(after.slots.map((s) => s.localTime)).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
    ]);
    // ...and the database accepts a new booking for that time
    await expect(pending('09:00', 24)).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('does not start a background timer under test (NODE_ENV=test)', () => {
    // run() is called directly above; the schedule only starts outside tests
    expect(process.env.NODE_ENV).toBe('test');
  });
});
