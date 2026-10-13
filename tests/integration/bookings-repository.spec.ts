import type { Kysely, Selectable } from 'kysely';
import { ApiException } from '../../src/common/api-error.js';
import { planBooking } from '../../src/bookings/booking-plan.js';
import {
  type BookingRecord,
  BookingsRepository,
  type NewBooking,
} from '../../src/bookings/bookings.repository.js';
import type { DB } from '../../src/database/database.types.js';
import { createTestDatabase } from '../helpers/database.js';

// The booking table's rules, through the repository (#42, #43, #44).
describe('BookingsRepository', () => {
  let db: Kysely<DB>;
  let repository: BookingsRepository;
  let service: { id: string };
  let originalSettings: Selectable<DB['settings']>;

  const PREFIX = 'Repository test ';
  const settings = {
    depositPercent: '50.00',
    depositHoldHours: 24,
    minNoticeHours: 24,
    bufferMinutes: 60,
  };
  const NOW = new Date('2027-05-20T10:00:00Z');

  // A booking for the 90-minute, R650 service at this UTC time
  function booking(
    startAt: string,
    overrides: Partial<NewBooking> = {},
  ): NewBooking {
    return {
      ...planBooking({
        service: { price: '650.00', durationMinutes: 90 },
        settings,
        startAt: new Date(startAt),
        now: NOW,
      }),
      serviceId: service.id,
      clientName: 'Sarah Mokoena',
      clientEmail: 'sarah@example.com',
      clientPhone: '+27821234567',
      notes: null,
      ...overrides,
    };
  }

  const conflict = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiException);
    return error as ApiException;
  };

  beforeAll(async () => {
    db = createTestDatabase();
    repository = new BookingsRepository(db);
    originalSettings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();
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
      .deleteFrom('bookings')
      .where('service_id', '=', service.id)
      .execute();
    await db
      .updateTable('settings')
      .set({
        deposit_percent: originalSettings.deposit_percent,
        buffer_minutes: originalSettings.buffer_minutes,
      })
      .where('id', '=', 1)
      .execute();
  });

  afterAll(async () => {
    await db
      .deleteFrom('services')
      .where('name', 'like', `${PREFIX}%`)
      .execute();
    await db.destroy();
  });

  describe('the snapshot (BR-4, #42)', () => {
    it('stores the price, duration, deposit and deadline the booking was made with', async () => {
      const saved = await repository.insert(
        booking('2027-06-01T07:00:00Z', { notes: 'Birthday makeup' }),
      );
      expect(saved).toMatchObject({
        serviceId: service.id,
        clientName: 'Sarah Mokoena',
        clientEmail: 'sarah@example.com',
        clientPhone: '+27821234567',
        priceAtBooking: '650.00',
        depositAmount: '325.00',
        status: 'pending',
        notes: 'Birthday makeup',
      });
      expect(saved.startAt.toISOString()).toBe('2027-06-01T07:00:00.000Z');
      expect(saved.endAt.toISOString()).toBe('2027-06-01T08:30:00.000Z'); // 90 minutes
      expect(saved.occupiedUntil.toISOString()).toBe(
        '2027-06-01T09:30:00.000Z',
      ); // + 60 buffer
      expect(saved.depositDueAt?.toISOString()).toBe(
        '2027-05-21T10:00:00.000Z',
      );
      expect(await repository.findById(saved.id)).toEqual(saved);
    });

    it('is not changed by later edits to the service or the settings', async () => {
      const saved = await repository.insert(booking('2027-06-01T07:00:00Z'));

      await db
        .updateTable('services')
        .set({
          name: `${PREFIX}Renamed`,
          price: '999.00',
          duration_minutes: 30,
          is_active: false,
        })
        .where('id', '=', service.id)
        .execute();
      await db
        .updateTable('settings')
        .set({ deposit_percent: '10', buffer_minutes: 0 })
        .where('id', '=', 1)
        .execute();

      const after = (await repository.findById(saved.id)) as BookingRecord;
      expect(after).toEqual(saved);
      expect(after).toMatchObject({
        priceAtBooking: '650.00',
        depositAmount: '325.00',
      });
      expect(after.endAt.getTime() - after.startAt.getTime()).toBe(90 * 60_000);
      expect(after.occupiedUntil.getTime() - after.endAt.getTime()).toBe(
        60 * 60_000,
      );

      await db
        .updateTable('services')
        .set({
          name: `${PREFIX}Soft Glam`,
          price: '650.00',
          duration_minutes: 90,
          is_active: true,
        })
        .where('id', '=', service.id)
        .execute();
    });

    it('stores a Confirmed booking with no deadline when there is no deposit', async () => {
      const free = planBooking({
        service: { price: '650.00', durationMinutes: 90 },
        settings: { ...settings, depositPercent: '0.00' },
        startAt: new Date('2027-06-01T07:00:00Z'),
        now: NOW,
      });
      const saved = await repository.insert({
        ...booking('2027-06-01T07:00:00Z'),
        ...free,
      });
      expect(saved).toMatchObject({
        status: 'confirmed',
        depositAmount: '0.00',
        depositDueAt: null,
      });
    });

    it('stores only the hash of the booking link token (BR-15)', async () => {
      const hash = Buffer.alloc(32, 7);
      const saved = await repository.insert(
        booking('2027-06-01T07:00:00Z', { bookingTokenHash: hash }),
      );
      const row = await db
        .selectFrom('bookings')
        .select(['booking_token_hash', 'booking_token_created_at'])
        .where('id', '=', saved.id)
        .executeTakeFirstOrThrow();
      expect(Buffer.from(row.booking_token_hash as Buffer).equals(hash)).toBe(
        true,
      );
      expect(row.booking_token_created_at).not.toBeNull();
    });
  });

  describe('references (#44)', () => {
    it('are readable, unique and increasing: BK-000123', async () => {
      const a = await repository.insert(booking('2027-06-01T07:00:00Z'));
      const b = await repository.insert(booking('2027-06-02T07:00:00Z'));
      const c = await repository.insert(booking('2027-06-03T07:00:00Z'));
      for (const { reference } of [a, b, c]) {
        expect(reference).toMatch(/^BK-\d{6,}$/);
      }
      const numbers = [a, b, c].map((r) => Number(r.reference.slice(3)));
      expect(numbers[1]).toBeGreaterThan(numbers[0]);
      expect(numbers[2]).toBeGreaterThan(numbers[1]);
      expect(new Set([a, b, c].map((r) => r.reference)).size).toBe(3);
    });

    it('are not reused after a booking is cancelled or deleted', async () => {
      const first = await repository.insert(booking('2027-06-01T07:00:00Z'));
      await db.deleteFrom('bookings').where('id', '=', first.id).execute();
      const second = await repository.insert(booking('2027-06-01T07:00:00Z'));
      expect(Number(second.reference.slice(3))).toBeGreaterThan(
        Number(first.reference.slice(3)),
      );
    });
  });

  describe('no double-booking: the exclusion constraint (BR-2, #43)', () => {
    // A Pending booking at 09:00 local (07:00Z) to 10:30, busy until 11:30
    const FIRST = '2027-06-01T07:00:00Z';

    it('refuses an overlapping booking with a friendly 409', async () => {
      await repository.insert(booking(FIRST));
      const error = await conflict(
        repository.insert(booking('2027-06-01T07:30:00Z')),
      );
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        code: 'SLOT_UNAVAILABLE',
        message: 'That time has just been booked. Please choose another time.',
        details: null,
      });
    });

    it('covers the duration plus the buffer: a start inside the buffer is refused', async () => {
      await repository.insert(booking(FIRST));
      // 08:30Z is when the appointment ends, 09:30Z when the buffer ends
      await conflict(repository.insert(booking('2027-06-01T08:30:00Z')));
      await conflict(repository.insert(booking('2027-06-01T09:29:00Z')));
    });

    it('allows a booking that starts exactly when the buffer ends', async () => {
      await repository.insert(booking(FIRST));
      await expect(
        repository.insert(booking('2027-06-01T09:30:00Z')),
      ).resolves.toMatchObject({
        status: 'pending',
      });
    });

    it('allows a booking that ends (buffer included) exactly when another starts', async () => {
      await repository.insert(booking('2027-06-01T09:30:00Z'));
      // 07:00Z + 90 + 60 minutes ends at 09:30Z
      await expect(repository.insert(booking(FIRST))).resolves.toBeDefined();
    });

    it('counts Confirmed bookings as well as Pending ones', async () => {
      await repository.insert(booking(FIRST));
      await db
        .updateTable('bookings')
        .set({
          status: 'confirmed',
          amount_received: '325.00',
          payment_verified_at: new Date(),
          payment_verified_by: await adminId(),
        })
        .where('service_id', '=', service.id)
        .execute();
      await conflict(repository.insert(booking('2027-06-01T07:30:00Z')));
    });

    it.each(['cancelled', 'expired'] as const)(
      'ignores %s bookings: the slot is free again',
      async (status) => {
        await repository.insert(booking(FIRST));
        await db
          .updateTable('bookings')
          .set({
            status,
            ...(status === 'cancelled'
              ? { cancelled_at: new Date(), cancelled_by: 'client' as const }
              : {}),
          })
          .where('service_id', '=', service.id)
          .execute();
        await expect(repository.insert(booking(FIRST))).resolves.toBeDefined();
      },
    );

    it('refuses the same time when two requests arrive at once: exactly one succeeds', async () => {
      const results = await Promise.allSettled([
        repository.insert(booking(FIRST, { clientEmail: 'a@example.com' })),
        repository.insert(booking(FIRST, { clientEmail: 'b@example.com' })),
      ]);
      const saved = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter((r) => r.status === 'rejected');
      expect(saved).toHaveLength(1);
      expect(refused).toHaveLength(1);
      const reason: unknown = refused[0].reason;
      expect((reason as ApiException).getStatus()).toBe(409);
    });

    it('is saved together with other changes, and rolled back with them', async () => {
      // An error inside the transaction undoes everything in it.
      await db
        .transaction()
        .execute(async (trx) => {
          await repository.insert(booking(FIRST), trx);
          throw new Error('something else in the same transaction failed');
        })
        .catch(() => undefined);
      const rows = await db
        .selectFrom('bookings')
        .select('id')
        .where('service_id', '=', service.id)
        .execute();
      expect(rows).toHaveLength(0);
    });
  });

  // Confirming a booking records who verified the payment, so a user is needed.
  async function adminId(): Promise<string> {
    const existing = await db
      .selectFrom('users')
      .select('id')
      .executeTakeFirst();
    if (existing) return existing.id;
    const created = await db
      .insertInto('users')
      .values({
        email: 'repository-test@example.com',
        password_hash: 'not-a-real-hash',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    createdUsers.push(created.id);
    return created.id;
  }
  const createdUsers: string[] = [];
  afterAll(async () => {
    if (createdUsers.length) {
      await db.updateTable('settings').set({ updated_by: null }).execute();
      await db.deleteFrom('users').where('id', 'in', createdUsers).execute();
    }
  });
});
