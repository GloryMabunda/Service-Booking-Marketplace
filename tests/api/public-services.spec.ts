import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from '../../src/app.factory.js';
import type { DB } from '../../src/database/database.types.js';
import type { PublicServices } from '../../src/services/services.service.js';
import {
  removeTestAdmin,
  signInTestAdmin,
  type TestAdmin,
} from '../helpers/admin.js';
import { createTestDatabase } from '../helpers/database.js';
import { bodyOf } from '../helpers/http.js';

// GET /api/services (#32) and hiding inactive services from clients (#33).
describe('Public services API', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let admin: TestAdmin;
  const PREFIX = 'Public test ';

  beforeAll(async () => {
    db = createTestDatabase();
    app = await createApp<INestApplication<App>>({ logger: false });
    await app.init();
    admin = await signInTestAdmin(app, db, 'public-services@example.com');
  });

  afterEach(async () => {
    const mine = db
      .selectFrom('services')
      .select('id')
      .where('name', 'like', `${PREFIX}%`);
    await db.deleteFrom('bookings').where('service_id', 'in', mine).execute();
    await db
      .deleteFrom('services')
      .where('name', 'like', `${PREFIX}%`)
      .execute();
  });

  afterAll(async () => {
    await removeTestAdmin(db, admin);
    await app.close();
    await db.destroy();
  });

  const http = () => request(app.getHttpServer());
  const get = async () => {
    const res = await http().get('/api/services').expect(200);
    return { res, body: bodyOf<PublicServices>(res) };
  };
  const mine = (body: PublicServices) =>
    body.services.filter((s) => s.name.startsWith(PREFIX));

  async function addService(name: string, price: string, isActive = true) {
    return db
      .insertInto('services')
      .values({
        name: PREFIX + name,
        description: `About ${name}`,
        price,
        duration_minutes: 90,
        is_active: isActive,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  it('needs no sign-in and may be cached for 60 seconds', async () => {
    const { res } = await get();
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('lists active services with the deposit worked out from the settings (BR-7)', async () => {
    await addService('Soft Glam', '650.00');
    await addService('Bridal', '1200.50');
    const { body } = await get();

    expect(body.depositPercent).toBe('50.00');
    expect(mine(body)).toEqual([
      {
        id: expect.any(String) as string,
        name: `${PREFIX}Bridal`,
        description: 'About Bridal',
        price: '1200.50',
        durationMinutes: 90,
        depositAmount: '600.25',
        availableForTravel: false,
        image: null,
      },
      {
        id: expect.any(String) as string,
        name: `${PREFIX}Soft Glam`,
        description: 'About Soft Glam',
        price: '650.00',
        durationMinutes: 90,
        depositAmount: '325.00',
        availableForTravel: false,
        image: null,
      },
    ]);
  });

  it('follows the deposit percentage when the owner changes it', async () => {
    await addService('Priced', '650.00');
    const patch = (depositPercent: string) =>
      http()
        .patch('/api/admin/settings')
        .set('Cookie', admin.cookie)
        .send({ depositPercent })
        .expect(200);
    try {
      await patch('30.00');
      const { body } = await get();
      expect(body.depositPercent).toBe('30.00');
      expect(mine(body)[0].depositAmount).toBe('195.00');
    } finally {
      await patch('50.00');
    }
  });

  it('shows the business details and the bookable date range', async () => {
    const before = Date.now();
    const { body } = await get();
    expect(body.business).toEqual({
      name: 'Your Business',
      email: 'bookings@example.com',
      phone: null,
    });
    const window = body.bookingWindow;
    expect(window.timeZone).toBe('Africa/Johannesburg');
    // 24 h notice + 2 h to pay, and 90 days ahead, from now
    const earliest = new Date(window.earliestStartAt).getTime();
    const latest = new Date(window.latestStartAt).getTime();
    expect(Math.abs(earliest - (before + 26 * 3_600_000))).toBeLessThan(5000);
    expect(Math.abs(latest - (before + 90 * 86_400_000))).toBeLessThan(5000);
    expect(window.firstDate).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(window.lastDate > window.firstDate).toBe(true);
  });

  describe('inactive services (BR-5, #33)', () => {
    it('are missing from the list', async () => {
      await addService('Visible', '100.00');
      await addService('Hidden', '100.00', false);
      const { body } = await get();
      expect(mine(body).map((s) => s.name)).toEqual([`${PREFIX}Visible`]);
    });

    it('disappear as soon as the owner deactivates them, and return when reactivated', async () => {
      const service = await addService('Toggled', '100.00');
      expect(mine((await get()).body)).toHaveLength(1);

      const setActive = (isActive: boolean) =>
        http()
          .patch(`/api/admin/services/${service.id}`)
          .set('Cookie', admin.cookie)
          .send({ isActive })
          .expect(200);
      await setActive(false);
      expect(mine((await get()).body)).toHaveLength(0);
      await setActive(true);
      expect(mine((await get()).body)).toHaveLength(1);
    });

    it('keep their existing bookings when deactivated', async () => {
      const service = await addService('Booked then hidden', '650.00');
      await db
        .insertInto('bookings')
        .values({
          service_id: service.id,
          client_name: 'Test Client',
          client_email: 'client@example.com',
          client_phone: '+27821234567',
          start_at: '2026-12-01T08:00:00Z',
          end_at: '2026-12-01T09:30:00Z',
          occupied_until: '2026-12-01T10:30:00Z',
          price_at_booking: '650.00',
          deposit_amount: '325.00',
          deposit_due_at: '2026-11-30T08:00:00Z',
          status: 'pending',
        })
        .execute();

      await http()
        .patch(`/api/admin/services/${service.id}`)
        .set('Cookie', admin.cookie)
        .send({ isActive: false })
        .expect(200);

      expect(mine((await get()).body)).toHaveLength(0); // clients can't see it
      const booking = await db
        .selectFrom('bookings')
        .select(['service_id', 'status', 'price_at_booking'])
        .where('service_id', '=', service.id)
        .executeTakeFirstOrThrow();
      expect(booking).toEqual({
        service_id: service.id,
        status: 'pending',
        price_at_booking: '650.00',
      });
    });
  });
});
