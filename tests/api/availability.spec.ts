import type { INestApplication } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from '../../src/app.factory.js';
import { AvailabilityService } from '../../src/availability/availability.service.js';
import type { WorkingDay } from '../../src/availability/availability.schema.js';
import {
  addDays,
  isoDayOfWeek,
  zonedTimeToUtc,
} from '../../src/availability/time-zone.js';
import type { DB } from '../../src/database/database.types.js';
import {
  removeTestAdmin,
  signInTestAdmin,
  type TestAdmin,
} from '../helpers/admin.js';
import { createTestDatabase } from '../helpers/database.js';
import { SA, upcoming } from '../helpers/dates.js';
import { bodyOf, errorBody } from '../helpers/http.js';

// Working hours, blocked times and slots (#34-#39, docs/api.md 4.2, 7.13, 7.14).
const PREFIX = 'Availability test ';

interface SlotsBody {
  serviceId: string;
  date: string;
  timeZone: string;
  slots: { startAt: string; endAt: string; localTime: string }[];
}

describe('Availability API', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let admin: TestAdmin;
  let service: { id: string };
  let originalWeek: Selectable<DB['availability']>[];
  let originalSettings: Selectable<DB['settings']>;

  const TUESDAY = upcoming(2);
  const SUNDAY = upcoming(7);
  const local = (date: string, time: string) => zonedTimeToUtc(date, time, SA);

  beforeAll(async () => {
    db = createTestDatabase();
    originalWeek = await db.selectFrom('availability').selectAll().execute();
    originalSettings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();
    app = await createApp<INestApplication<App>>({ logger: false });
    await app.init();
    admin = await signInTestAdmin(app, db, 'availability-test@example.com');
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
    await db.deleteFrom('blocked_times').execute();
  });

  afterAll(async () => {
    for (const row of originalWeek) {
      await db
        .updateTable('availability')
        .set({
          is_working_day: row.is_working_day,
          start_time: row.start_time,
          end_time: row.end_time,
        })
        .where('day_of_week', '=', row.day_of_week)
        .execute();
    }
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
    await removeTestAdmin(db, admin);
    await app.close();
    await db.destroy();
  });

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set('Cookie', admin.cookie);
  const slots = async (date: string, serviceId = service.id) =>
    bodyOf<SlotsBody>(
      await http()
        .get('/api/availability')
        .query({ serviceId, date })
        .expect(200),
    );
  const times = async (date: string) =>
    (await slots(date)).slots.map((s) => s.localTime);

  async function book(
    date: string,
    time: string,
    status: 'pending' | 'confirmed' | 'cancelled' | 'expired' = 'pending',
  ) {
    const start = local(date, time);
    await db
      .insertInto('bookings')
      .values({
        service_id: service.id,
        client_name: 'Test Client',
        client_email: 'client@example.com',
        client_phone: '+27821234567',
        start_at: start,
        end_at: new Date(start.getTime() + 90 * 60_000),
        occupied_until: new Date(start.getTime() + 150 * 60_000), // 90 min + 60 buffer
        price_at_booking: '650.00',
        deposit_amount: '325.00',
        deposit_due_at: new Date(start.getTime() - 3_600_000),
        status,
        ...(status === 'cancelled'
          ? { cancelled_at: new Date(), cancelled_by: 'client' as const }
          : {}),
      })
      .execute();
  }

  const blockRange = (startAt: Date, endAt: Date, reason?: string) =>
    asAdmin(http().post('/api/admin/blocked-times')).send({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      ...(reason ? { reason } : {}),
    });

  describe('working hours (#34)', () => {
    it('is protected: 401 without a session', async () => {
      await http().get('/api/admin/availability').expect(401);
      await http().put('/api/admin/availability').send({}).expect(401);
    });

    it('returns the seven days in the business time zone', async () => {
      const res = await asAdmin(http().get('/api/admin/availability')).expect(
        200,
      );
      const body = bodyOf<{ timeZone: string; days: WorkingDay[] }>(res);
      expect(body.timeZone).toBe(SA);
      expect(body.days).toEqual([
        {
          dayOfWeek: 1,
          isWorkingDay: true,
          startTime: '09:00',
          endTime: '17:00',
        },
        {
          dayOfWeek: 2,
          isWorkingDay: true,
          startTime: '09:00',
          endTime: '17:00',
        },
        {
          dayOfWeek: 3,
          isWorkingDay: true,
          startTime: '09:00',
          endTime: '17:00',
        },
        {
          dayOfWeek: 4,
          isWorkingDay: true,
          startTime: '09:00',
          endTime: '17:00',
        },
        {
          dayOfWeek: 5,
          isWorkingDay: true,
          startTime: '09:00',
          endTime: '17:00',
        },
        {
          dayOfWeek: 6,
          isWorkingDay: true,
          startTime: '08:00',
          endTime: '14:00',
        },
        { dayOfWeek: 7, isWorkingDay: false, startTime: null, endTime: null },
      ]);
    });

    it('replaces the whole week, and the new hours decide the slots', async () => {
      const week: WorkingDay[] = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
        dayOfWeek,
        isWorkingDay: dayOfWeek === 2,
        startTime: dayOfWeek === 2 ? '10:00' : null,
        endTime: dayOfWeek === 2 ? '14:00' : null,
      }));
      const res = await asAdmin(http().put('/api/admin/availability'))
        .send({ days: week })
        .expect(200);
      expect(bodyOf<{ days: WorkingDay[] }>(res).days).toEqual(week);

      // 10:00-14:00 with a 90-minute service: 10:00, 11:00, 12:00 (ends 13:30)
      expect(await times(TUESDAY)).toEqual(['10:00', '11:00', '12:00']);
      // Every other day is now off.
      expect(await times(upcoming(3))).toEqual([]);

      await asAdmin(http().put('/api/admin/availability'))
        .send({ days: originalWeek.map(toDay) })
        .expect(200);
    });

    it('offers no slots on a day off', async () => {
      expect(await times(SUNDAY)).toEqual([]);
    });

    it('lists every problem with the week', async () => {
      const week = originalWeek.map(toDay);
      week[0] = { ...week[0], endTime: '08:00' };
      const res = await asAdmin(http().put('/api/admin/availability'))
        .send({ days: week })
        .expect(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
      expect(errorBody(res).details).toEqual([
        {
          field: 'days.0.endTime',
          message: 'The end time must be after the start time.',
        },
      ]);

      const six = await asAdmin(http().put('/api/admin/availability'))
        .send({ days: originalWeek.map(toDay).slice(0, 6) })
        .expect(400);
      expect(errorBody(six).details).toEqual([
        {
          field: 'days',
          message: 'Send exactly seven days, Monday to Sunday.',
        },
      ]);
    });
  });

  describe('GET /api/availability (#39)', () => {
    it('needs no sign-in and is never cached', async () => {
      const res = await http()
        .get('/api/availability')
        .query({ serviceId: service.id, date: TUESDAY })
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('returns the hourly slots in the business time zone', async () => {
      const body = await slots(TUESDAY);
      expect(body).toMatchObject({
        serviceId: service.id,
        date: TUESDAY,
        timeZone: SA,
      });
      // 09:00 to 15:00: a 90-minute service started at 16:00 would end after closing.
      expect(body.slots.map((s) => s.localTime)).toEqual([
        '09:00',
        '10:00',
        '11:00',
        '12:00',
        '13:00',
        '14:00',
        '15:00',
      ]);
      expect(body.slots[0]).toEqual({
        startAt: local(TUESDAY, '09:00').toISOString().replace('.000Z', 'Z'),
        endAt: local(TUESDAY, '10:30').toISOString().replace('.000Z', 'Z'),
        localTime: '09:00',
      });
      expect(body.slots[0].startAt.endsWith('T07:00:00Z')).toBe(true); // UTC+2
    });

    it('returns 400 VALIDATION_FAILED for a missing or bad parameter', async () => {
      const res = await http().get('/api/availability').expect(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
      expect(errorBody(res).details).toEqual([
        { field: 'serviceId', message: 'Enter the service.' },
        { field: 'date', message: 'Enter a date such as 2026-11-03.' },
      ]);
      await http()
        .get('/api/availability')
        .query({ serviceId: service.id, date: '2026-02-30' })
        .expect(400);
    });

    it('returns 400 SERVICE_UNAVAILABLE for an unknown or inactive service', async () => {
      const unknown = await http()
        .get('/api/availability')
        .query({
          serviceId: '5b0d3c1e-0000-4000-8000-0000000000ff',
          date: TUESDAY,
        })
        .expect(400);
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
      const res = await http()
        .get('/api/availability')
        .query({ serviceId: inactive.id, date: TUESDAY })
        .expect(400);
      expect(errorBody(res).code).toBe('SERVICE_UNAVAILABLE');
    });

    it('excludes starts that clash with a Pending or Confirmed booking, buffer included', async () => {
      // Booked 11:00-12:30 and busy until 13:30 with its buffer
      await book(TUESDAY, '11:00', 'pending');
      expect(await times(TUESDAY)).toEqual(['14:00', '15:00']);
    });

    it('treats Confirmed bookings the same way', async () => {
      await book(TUESDAY, '11:00', 'confirmed');
      expect(await times(TUESDAY)).toEqual(['14:00', '15:00']);
    });

    it('ignores Cancelled and Expired bookings (the slot is free again)', async () => {
      await book(TUESDAY, '11:00', 'cancelled');
      await book(TUESDAY, '13:00', 'expired');
      expect(await times(TUESDAY)).toHaveLength(7);
    });

    it('ignores a booking made for the day before', async () => {
      await book(addDays(TUESDAY, -1), '15:00');
      expect(await times(TUESDAY)).toHaveLength(7);
    });
  });

  describe('blocked times (#35)', () => {
    it('is protected: 401 without a session', async () => {
      await http().get('/api/admin/blocked-times').expect(401);
      await http()
        .post('/api/admin/blocked-times')
        .send({
          startAt: '2026-11-05T22:00:00Z',
          endAt: '2026-11-06T22:00:00Z',
        })
        .expect(401);
      await http()
        .delete('/api/admin/blocked-times/5b0d3c1e-0000-4000-8000-000000000001')
        .expect(401);
    });

    it('creates, lists and deletes a blocked time', async () => {
      const startAt = local(TUESDAY, '12:00');
      const endAt = local(TUESDAY, '13:00');
      const created = await blockRange(startAt, endAt, 'Wedding trial').expect(
        201,
      );
      const body = bodyOf<{
        blockedTime: {
          id: string;
          startAt: string;
          endAt: string;
          reason: string;
        };
        overlappingBookings: string[];
      }>(created);
      expect(body.blockedTime).toMatchObject({
        startAt: startAt.toISOString().replace('.000Z', 'Z'),
        endAt: endAt.toISOString().replace('.000Z', 'Z'),
        reason: 'Wedding trial',
      });
      expect(body.overlappingBookings).toEqual([]);

      const list = await asAdmin(
        http()
          .get('/api/admin/blocked-times')
          .query({ from: TUESDAY, to: TUESDAY }),
      ).expect(200);
      expect(
        bodyOf<{ blockedTimes: { id: string }[] }>(list).blockedTimes.map(
          (b) => b.id,
        ),
      ).toEqual([body.blockedTime.id]);

      await asAdmin(
        http().delete(`/api/admin/blocked-times/${body.blockedTime.id}`),
      ).expect(204);
      const after = await asAdmin(
        http()
          .get('/api/admin/blocked-times')
          .query({ from: TUESDAY, to: TUESDAY }),
      ).expect(200);
      expect(bodyOf<{ blockedTimes: unknown[] }>(after).blockedTimes).toEqual(
        [],
      );
    });

    it('requires the end to be after the start', async () => {
      const at = local(TUESDAY, '12:00');
      const res = await blockRange(at, at).expect(400);
      expect(errorBody(res).details).toEqual([
        { field: 'endAt', message: 'The end must be after the start.' },
      ]);
      await blockRange(at, new Date(at.getTime() - 1000)).expect(400);
    });

    it('rejects times that are not UTC instants', async () => {
      const res = await asAdmin(http().post('/api/admin/blocked-times'))
        .send({ startAt: '2026-11-05', endAt: '2026-11-06T22:00:00Z' })
        .expect(400);
      expect(errorBody(res).details?.[0].field).toBe('startAt');
    });

    it('removes the blocked hours from the slots, buffer included, and returns them when deleted', async () => {
      const created = await blockRange(
        local(TUESDAY, '12:00'),
        local(TUESDAY, '13:00'),
      ).expect(201);
      // 10:00 needs until 12:30, so it clashes with the block; 12:00 clashes.
      expect(await times(TUESDAY)).toEqual([
        '09:00',
        '13:00',
        '14:00',
        '15:00',
      ]);

      const id = bodyOf<{ blockedTime: { id: string } }>(created).blockedTime
        .id;
      await asAdmin(http().delete(`/api/admin/blocked-times/${id}`)).expect(
        204,
      );
      expect(await times(TUESDAY)).toHaveLength(7);
    });

    it('blocks a whole day, midnight to midnight in the business time zone', async () => {
      const start = local(TUESDAY, '00:00');
      const end = local(addDays(TUESDAY, 1), '00:00');
      await blockRange(start, end, 'Day off').expect(201);
      expect(await times(TUESDAY)).toEqual([]);
      // The next day is untouched.
      expect(await times(addDays(TUESDAY, 1))).not.toEqual([]);
    });

    it('lists the bookings inside the blocked time without cancelling them', async () => {
      await book(TUESDAY, '11:00', 'confirmed');
      const res = await blockRange(
        local(TUESDAY, '10:00'),
        local(TUESDAY, '14:00'),
      ).expect(201);
      const reference = await db
        .selectFrom('bookings')
        .select(['reference', 'status'])
        .where('service_id', '=', service.id)
        .executeTakeFirstOrThrow();
      expect(
        bodyOf<{ overlappingBookings: string[] }>(res).overlappingBookings,
      ).toEqual([reference.reference]);
      expect(reference.status).toBe('confirmed'); // not cancelled
    });

    it('returns 404 NOT_FOUND for an unknown id and for an id that is not a UUID', async () => {
      for (const id of ['5b0d3c1e-0000-4000-8000-0000000000ff', 'not-an-id']) {
        const res = await asAdmin(
          http().delete(`/api/admin/blocked-times/${id}`),
        ).expect(404);
        expect(errorBody(res).code).toBe('NOT_FOUND');
      }
    });
  });

  // The booking window with a fixed clock, so the maths is exact (#38).
  describe('minimum notice, advance window and payment window (#38)', () => {
    let availability: AvailabilityService;
    const DAY = '2027-03-02'; // a Tuesday
    // 12:00 the day before: 24 h notice + 2 h payment window = 14:00 tomorrow
    const NOW = zonedTimeToUtc(addDays(DAY, -1), '12:00', SA);

    const timesAt = async (date: string, now: Date) =>
      (await availability.slotsFor(service.id, date, now)).slots.map(
        (s) => s.localTime,
      );
    const setSettings = (values: Partial<Selectable<DB['settings']>>) =>
      db.updateTable('settings').set(values).where('id', '=', 1).execute();

    beforeAll(() => {
      availability = app.get(AvailabilityService);
      expect(isoDayOfWeek(DAY)).toBe(2);
    });

    afterEach(() =>
      setSettings({
        min_notice_hours: originalSettings.min_notice_hours,
        max_advance_days: originalSettings.max_advance_days,
        deposit_percent: originalSettings.deposit_percent,
        min_payment_window_hours: originalSettings.min_payment_window_hours,
        deposit_hold_hours: originalSettings.deposit_hold_hours,
      }),
    );

    it('hides slots within the minimum notice plus the payment window when a deposit applies', async () => {
      expect(await timesAt(DAY, NOW)).toEqual(['14:00', '15:00']);
    });

    it('drops the payment window when there is no deposit (BR-9)', async () => {
      await setSettings({ deposit_percent: '0' });
      expect(await timesAt(DAY, NOW)).toEqual([
        '12:00',
        '13:00',
        '14:00',
        '15:00',
      ]);
    });

    it('follows the minimum notice setting', async () => {
      await setSettings({ min_notice_hours: 48 });
      expect(await timesAt(DAY, NOW)).toEqual([]); // 12:00 + 48 h + 2 h is after the day
      await setSettings({ min_notice_hours: 0 });
      // 12:00 + 0 h + 2 h payment window = 14:00 today, so tomorrow is wide open
      expect(await timesAt(DAY, NOW)).toHaveLength(7);
    });

    it('follows the payment window setting', async () => {
      // 12:00 + 24 h notice + 3 h = 15:00 tomorrow
      await setSettings({ min_payment_window_hours: 3 });
      expect(await timesAt(DAY, NOW)).toEqual(['15:00']);
      // + 4 h = 16:00, after the last start of the day
      await setSettings({ min_payment_window_hours: 4 });
      expect(await timesAt(DAY, NOW)).toEqual([]);
    });

    it('hides slots beyond the advance window', async () => {
      await setSettings({ max_advance_days: 1 });
      // latest start = 12:00 + 1 day = 12:00 tomorrow, but earliest is 14:00
      expect(await timesAt(DAY, NOW)).toEqual([]);
      await setSettings({ max_advance_days: 90 });
      const farDay = addDays(DAY, 100);
      expect(await timesAt(farDay, NOW)).toEqual([]);
    });

    it('keeps the last allowed moment itself', async () => {
      // latest start exactly 14:00 tomorrow = earliest start: only 14:00
      await setSettings({
        max_advance_days: 1,
        min_notice_hours: 0,
        min_payment_window_hours: 1,
      });
      // earliest = 13:00 today; latest = 12:00 tomorrow
      expect(await timesAt(DAY, NOW)).toEqual([
        '09:00',
        '10:00',
        '11:00',
        '12:00',
      ]);
    });

    describe('isSlotOpen: the same rules, re-checked for one exact start time', () => {
      it('is true for an offered slot', async () => {
        expect(
          await availability.isSlotOpen(service.id, local(DAY, '14:00'), NOW),
        ).toBe(true);
      });

      it.each([
        ['too soon (inside notice and payment window)', '13:00'],
        ['not on the slot interval', '14:30'],
        ['after the last start of the day', '16:00'],
        ['before opening', '08:00'],
      ])('is false for a time that is %s', async (_label, time) => {
        expect(
          await availability.isSlotOpen(service.id, local(DAY, time), NOW),
        ).toBe(false);
      });

      it('is false once the slot is booked, and true again after a cancellation', async () => {
        await book(DAY, '14:00', 'pending');
        expect(
          await availability.isSlotOpen(service.id, local(DAY, '14:00'), NOW),
        ).toBe(false);
        await db
          .updateTable('bookings')
          .set({
            status: 'cancelled',
            cancelled_at: new Date(),
            cancelled_by: 'client',
          })
          .where('service_id', '=', service.id)
          .execute();
        expect(
          await availability.isSlotOpen(service.id, local(DAY, '14:00'), NOW),
        ).toBe(true);
      });

      it('is false for a day off', async () => {
        const sunday = addDays(DAY, 5);
        expect(isoDayOfWeek(sunday)).toBe(7);
        expect(
          await availability.isSlotOpen(
            service.id,
            local(sunday, '10:00'),
            NOW,
          ),
        ).toBe(false);
      });
    });
  });
});

describe('Availability rate limit', () => {
  let app: INestApplication<App>;
  let db: Kysely<DB>;
  let serviceId: string;

  beforeAll(async () => {
    db = createTestDatabase();
    app = await createApp<INestApplication<App>>({ logger: false });
    await app.init();
    serviceId = (
      await db
        .insertInto('services')
        .values({
          name: `${PREFIX}Limited`,
          price: '1.00',
          duration_minutes: 30,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await db.deleteFrom('services').where('id', '=', serviceId).execute();
    await app.close();
    await db.destroy();
  });

  it('allows 60 requests a minute per IP address, then answers 429 with Retry-After', async () => {
    const date = upcoming(2);
    const get = () =>
      request(app.getHttpServer())
        .get('/api/availability')
        .query({ serviceId, date });

    const first = await get().expect(200);
    expect(first.headers['ratelimit-limit']).toBe('60');
    expect(first.headers['ratelimit-remaining']).toBe('59');

    for (let i = 1; i < 60; i++) await get().expect(200);

    const blocked = await get().expect(429);
    expect(errorBody(blocked).code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(55);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(blocked.headers['ratelimit-limit']).toBe('60');
    expect(blocked.headers['ratelimit-remaining']).toBe('0');
  });
});

function toDay(row: Selectable<DB['availability']>): WorkingDay {
  return {
    dayOfWeek: row.day_of_week,
    isWorkingDay: row.is_working_day,
    startTime: row.start_time?.slice(0, 5) ?? null,
    endTime: row.end_time?.slice(0, 5) ?? null,
  };
}
