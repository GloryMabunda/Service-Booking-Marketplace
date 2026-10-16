import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from '../../src/app.factory.js';
import type { DB } from '../../src/database/database.types.js';
import type { Service } from '../../src/services/service.schema.js';
import {
  removeTestAdmin,
  signInTestAdmin,
  type TestAdmin,
} from '../helpers/admin.js';
import { createTestDatabase } from '../helpers/database.js';
import { bodyOf, errorBody } from '../helpers/http.js';

// /api/admin/services (#30, docs/api.md 7.12).
describe('Admin services API', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let admin: TestAdmin;

  // Every service made here has this prefix, so cleanup can't touch anything else.
  const PREFIX = 'API test ';
  const serviceOf = (res: request.Response) =>
    bodyOf<{ service: Service }>(res).service;
  const servicesOf = (res: request.Response) =>
    bodyOf<{ services: Service[] }>(res).services;

  beforeAll(async () => {
    db = createTestDatabase();
    app = await createApp<INestApplication<App>>({ logger: false });
    await app.init();
    admin = await signInTestAdmin(app, db, 'services-test@example.com');
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
  const create = (body: object) =>
    http().post('/api/admin/services').set('Cookie', admin.cookie).send(body);
  const list = (query = '') =>
    http().get(`/api/admin/services${query}`).set('Cookie', admin.cookie);
  const valid = (name: string) => ({
    name: PREFIX + name,
    price: '650',
    durationMinutes: 90,
  });

  // Each booking is a day later, so several bookings never overlap (BR-2).
  async function bookService(serviceId: string, dayOffset = 0): Promise<void> {
    const day = String(1 + dayOffset).padStart(2, '0');
    await db
      .insertInto('bookings')
      .values({
        service_id: serviceId,
        client_name: 'Test Client',
        client_email: 'client@example.com',
        client_phone: '+27821234567',
        start_at: `2026-12-${day}T08:00:00Z`,
        end_at: `2026-12-${day}T09:30:00Z`,
        occupied_until: `2026-12-${day}T10:30:00Z`,
        price_at_booking: '650.00',
        deposit_amount: '325.00',
        deposit_due_at: '2026-11-30T08:00:00Z',
        status: 'pending',
      })
      .execute();
  }

  it('protects every endpoint: 401 without a session', async () => {
    const id = '5b0d3c1e-0000-4000-8000-000000000001';
    await http().get('/api/admin/services').expect(401);
    await http().post('/api/admin/services').send(valid('x')).expect(401);
    await http().patch(`/api/admin/services/${id}`).send({}).expect(401);
    await http().delete(`/api/admin/services/${id}`).expect(401);
  });

  describe('POST', () => {
    it('creates a service, tidied, with the defaults', async () => {
      const res = await create({
        ...valid('Soft Glam'),
        name: `  ${PREFIX}Soft Glam  `,
      }).expect(201);
      expect(serviceOf(res)).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        name: `${PREFIX}Soft Glam`,
        description: '',
        price: '650.00',
        durationMinutes: 90,
        isActive: true,
        availableAtOurPlace: true,
        availableForTravel: false,
        image: null,
        bookingCount: 0,
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
    });

    it('lists every invalid field, and rejects unknown ones', async () => {
      const res = await create({
        name: '',
        price: '-5',
        durationMinutes: 0,
        colour: 'pink',
      }).expect(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
      expect(errorBody(res).details).toEqual(
        expect.arrayContaining([
          { field: 'name', message: 'Enter the service name.' },
          { field: 'price', message: 'Enter a price such as "650.00".' },
          {
            field: 'durationMinutes',
            message: 'The duration must be between 1 and 720 minutes.',
          },
          { field: '(body)', message: 'Unknown field: colour.' },
        ]),
      );
    });

    it('returns 409 SERVICE_NAME_TAKEN for a name in use, ignoring capitals', async () => {
      await create(valid('Bridal')).expect(201);
      const res = await create({
        ...valid('Bridal'),
        name: `${PREFIX}BRIDAL`,
      }).expect(409);
      expect(errorBody(res)).toEqual({
        statusCode: 409,
        code: 'SERVICE_NAME_TAKEN',
        message: 'Another service already has this name.',
        details: null,
      });
    });
  });

  describe('GET', () => {
    it('lists services sorted by name, ignoring capitals, with booking counts', async () => {
      const b = serviceOf(await create(valid('b second')).expect(201));
      await create(valid('A first')).expect(201);
      await create(valid('C third')).expect(201);
      await bookService(b.id, 0);
      await bookService(b.id, 1);

      const res = await list().expect(200);
      const mine = servicesOf(res).filter((s) => s.name.startsWith(PREFIX));
      expect(mine.map((s) => s.name)).toEqual([
        `${PREFIX}A first`,
        `${PREFIX}b second`,
        `${PREFIX}C third`,
      ]);
      expect(mine.map((s) => s.bookingCount)).toEqual([0, 2, 0]);
    });

    it('includes inactive services by default, and hides them with includeInactive=false', async () => {
      await create(valid('Active')).expect(201);
      await create({ ...valid('Hidden'), isActive: false }).expect(201);

      const all = servicesOf(await list().expect(200));
      expect(
        all
          .filter((s) => s.name.startsWith(PREFIX))
          .map((s) => s.isActive)
          .sort(),
      ).toEqual([false, true]);

      const activeOnly = servicesOf(
        await list('?includeInactive=false').expect(200),
      );
      expect(
        activeOnly.filter((s) => s.name.startsWith(PREFIX)).map((s) => s.name),
      ).toEqual([`${PREFIX}Active`]);
    });

    it('rejects an includeInactive that is not true or false', async () => {
      const res = await list('?includeInactive=maybe').expect(400);
      expect(errorBody(res).details).toEqual([
        { field: 'includeInactive', message: 'Must be true or false.' },
      ]);
    });
  });

  describe('PATCH', () => {
    it('changes only the fields sent and updates updatedAt', async () => {
      const created = serviceOf(await create(valid('Editable')).expect(201));
      // Times are given to the second, so the change must be a second later
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const res = await http()
        .patch(`/api/admin/services/${created.id}`)
        .set('Cookie', admin.cookie)
        .send({ price: '700', isActive: false })
        .expect(200);
      const updated = serviceOf(res);
      expect(updated).toMatchObject({
        id: created.id,
        name: created.name, // unchanged
        durationMinutes: 90, // unchanged
        price: '700.00',
        isActive: false,
      });
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt > created.updatedAt).toBe(true);
    });

    it('accepts an empty patch and returns the service unchanged', async () => {
      const created = serviceOf(await create(valid('Same')).expect(201));
      const res = await http()
        .patch(`/api/admin/services/${created.id}`)
        .set('Cookie', admin.cookie)
        .send({})
        .expect(200);
      expect(serviceOf(res)).toEqual(created);
    });

    it("does not change a booking's price or duration (BR-4)", async () => {
      const created = serviceOf(await create(valid('Priced')).expect(201));
      await bookService(created.id);
      await http()
        .patch(`/api/admin/services/${created.id}`)
        .set('Cookie', admin.cookie)
        .send({ price: '999', durationMinutes: 30 })
        .expect(200);
      const booking = await db
        .selectFrom('bookings')
        .select(['price_at_booking', 'start_at', 'end_at'])
        .where('service_id', '=', created.id)
        .executeTakeFirstOrThrow();
      expect(booking.price_at_booking).toBe('650.00');
      expect(
        new Date(booking.end_at).getTime() -
          new Date(booking.start_at).getTime(),
      ).toBe(90 * 60_000);
    });

    it('returns 409 when renaming to a name in use', async () => {
      await create(valid('Taken')).expect(201);
      const other = serviceOf(await create(valid('Other')).expect(201));
      const res = await http()
        .patch(`/api/admin/services/${other.id}`)
        .set('Cookie', admin.cookie)
        .send({ name: `${PREFIX}taken` })
        .expect(409);
      expect(errorBody(res).code).toBe('SERVICE_NAME_TAKEN');
    });

    it('allows a service to keep its own name when other fields change', async () => {
      const created = serviceOf(await create(valid('Keep')).expect(201));
      await http()
        .patch(`/api/admin/services/${created.id}`)
        .set('Cookie', admin.cookie)
        .send({ name: created.name, price: '10' })
        .expect(200);
    });

    it.each([
      ['an unknown id', '5b0d3c1e-0000-4000-8000-0000000000ff'],
      ['an id that is not a UUID', 'not-an-id'],
    ])('returns 404 NOT_FOUND for %s', async (_label, id) => {
      const res = await http()
        .patch(`/api/admin/services/${id}`)
        .set('Cookie', admin.cookie)
        .send({ price: '10' })
        .expect(404);
      expect(errorBody(res).code).toBe('NOT_FOUND');
    });

    it('validates the fields', async () => {
      const created = serviceOf(await create(valid('Checked')).expect(201));
      const res = await http()
        .patch(`/api/admin/services/${created.id}`)
        .set('Cookie', admin.cookie)
        .send({ durationMinutes: 721 })
        .expect(400);
      expect(errorBody(res).details).toEqual([
        {
          field: 'durationMinutes',
          message: 'The duration must be between 1 and 720 minutes.',
        },
      ]);
    });
  });

  describe('DELETE', () => {
    it('deletes a service that has no bookings: 204 and it is gone', async () => {
      const created = serviceOf(await create(valid('Unbooked')).expect(201));
      const res = await http()
        .delete(`/api/admin/services/${created.id}`)
        .set('Cookie', admin.cookie)
        .expect(204);
      expect(res.body).toEqual({});
      const gone = await db
        .selectFrom('services')
        .select('id')
        .where('id', '=', created.id)
        .executeTakeFirst();
      expect(gone).toBeUndefined();
    });

    it('deactivates instead of deleting when the service has bookings', async () => {
      const created = serviceOf(await create(valid('Booked')).expect(201));
      await bookService(created.id);

      const res = await http()
        .delete(`/api/admin/services/${created.id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(bodyOf<{ deactivated: boolean }>(res).deactivated).toBe(true);
      expect(serviceOf(res)).toMatchObject({
        id: created.id,
        isActive: false,
        bookingCount: 1,
      });

      // Still there, with its booking untouched.
      const bookings = await db
        .selectFrom('bookings')
        .select('id')
        .where('service_id', '=', created.id)
        .execute();
      expect(bookings).toHaveLength(1);
    });

    it.each([
      ['an unknown id', '5b0d3c1e-0000-4000-8000-0000000000ff'],
      ['an id that is not a UUID', 'not-an-id'],
    ])('returns 404 NOT_FOUND for %s', async (_label, id) => {
      const res = await http()
        .delete(`/api/admin/services/${id}`)
        .set('Cookie', admin.cookie)
        .expect(404);
      expect(errorBody(res).code).toBe('NOT_FOUND');
    });
  });
});
