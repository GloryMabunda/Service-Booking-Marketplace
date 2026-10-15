import type { INestApplication } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from '../../src/app.factory.js';
import type { DB } from '../../src/database/database.types.js';
import {
  removeTestAdmin,
  signInTestAdmin,
  type TestAdmin,
} from '../helpers/admin.js';
import { createTestDatabase } from '../helpers/database.js';
import { bodyOf, errorBody } from '../helpers/http.js';
import type { Settings } from '../../src/settings/settings.schema.js';

const settingsOf = (res: request.Response) =>
  bodyOf<{ settings: Settings }>(res).settings;

// GET and PATCH /api/admin/settings (#28, docs/api.md section 7.15).
describe('Admin settings API', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  let admin: TestAdmin;
  let original: Selectable<DB['settings']>;

  beforeAll(async () => {
    db = createTestDatabase();
    original = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();
    app = await createApp<INestApplication<App>>({ logger: false });
    await app.init();
    admin = await signInTestAdmin(app, db, 'settings-test@example.com');
  });

  afterAll(async () => {
    // Put the seeded row back exactly, then remove the test admin.
    await db
      .updateTable('settings')
      .set({
        ...original,
        banking_details: JSON.stringify(original.banking_details),
      })
      .where('id', '=', 1)
      .execute();
    await removeTestAdmin(db, admin);
    await app.close();
    await db.destroy();
  });

  const get = () =>
    request(app.getHttpServer())
      .get('/api/admin/settings')
      .set('Cookie', admin.cookie);
  const patch = (body: object) =>
    request(app.getHttpServer())
      .patch('/api/admin/settings')
      .set('Cookie', admin.cookie)
      .send(body);

  it('requires a signed-in admin', async () => {
    await request(app.getHttpServer()).get('/api/admin/settings').expect(401);
    await request(app.getHttpServer())
      .patch('/api/admin/settings')
      .send({ minNoticeHours: 1 })
      .expect(401);
  });

  it('returns the seeded Make Up by Glory settings', async () => {
    const res = await get().expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      settings: {
        minNoticeHours: 24,
        maxAdvanceDays: 90,
        slotIntervalMinutes: 60,
        bufferMinutes: 60,
        depositPercent: '50.00',
        depositRefundable: true,
        refundCutoffHours: 24,
        depositHoldHours: 24,
        minPaymentWindowHours: 2,
        timeZone: 'Africa/Johannesburg',
        bankingDetails: {
          accountName: 'Not set yet',
          bank: 'Not set yet',
          accountNumber: 'Not set yet',
          branchCode: 'Not set yet',
          accountType: 'Not set yet',
        },
        businessName: 'Make Up by Glory',
        businessEmail: 'bookings@example.com',
        businessPhone: null,
        homeAddress: null,
        travelCallOutFee: '0.00',
        travelRatePerKm: '0.00',
        travelFreeKm: 0,
        travelMaxKm: 30,
        travelChargeReturn: true,
        travelExtraMinutes: 30,
        updatedAt: expect.stringMatching(
          // To the second, as the API document says (section 1)
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/,
        ) as string,
      },
    });
  });

  it('changes only the fields sent, and returns the full settings', async () => {
    const res = await patch({
      depositPercent: '30',
      businessPhone: '082 123 4567',
      bankingDetails: {
        accountName: 'Make Up by Glory',
        bank: 'Example Bank',
        accountNumber: '1234567890',
        branchCode: '250655',
        accountType: 'Cheque',
      },
    }).expect(200);
    expect(settingsOf(res)).toMatchObject({
      depositPercent: '30.00',
      businessPhone: '+27821234567',
      bankingDetails: { bank: 'Example Bank' },
      minNoticeHours: 24, // unchanged
    });

    // Saved, and recorded who changed it.
    const row = await db
      .selectFrom('settings')
      .select(['deposit_percent', 'updated_by'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ deposit_percent: '30.00', updated_by: admin.id });
    expect(settingsOf(await get().expect(200)).depositPercent).toBe('30.00');
  });

  it('removes the phone with null', async () => {
    const res = await patch({ businessPhone: null }).expect(200);
    expect(settingsOf(res).businessPhone).toBeNull();
  });

  it('lists every invalid field', async () => {
    const res = await patch({
      minNoticeHours: -1,
      timeZone: 'Mars/Olympus',
      favouriteColour: 'pink',
    }).expect(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    expect(errorBody(res).details).toEqual(
      expect.arrayContaining([
        { field: 'minNoticeHours', message: 'Must be between 0 and 720.' },
        {
          field: 'timeZone',
          message: 'Enter a time zone such as Africa/Johannesburg.',
        },
        { field: '(body)', message: 'Unknown field: favouriteColour.' },
      ]),
    );
  });

  it('refuses a payment window longer than the deposit hold, even when only one of them changes (BR-9)', async () => {
    // The hold is 24 h, so a 30 h window is too long.
    const res = await patch({ minPaymentWindowHours: 30 }).expect(400);
    expect(errorBody(res).details).toEqual([
      {
        field: 'minPaymentWindowHours',
        message:
          "The minimum payment window (30 h) can't be longer than the deposit hold (24 h).",
      },
    ]);
    // The window is 2 h, so a 1 h hold is too short.
    const shorter = await patch({ depositHoldHours: 1 }).expect(400);
    expect(errorBody(shorter).details?.[0].field).toBe('depositHoldHours');
    // Nothing was saved.
    expect(settingsOf(await get()).depositHoldHours).toBe(24);
  });
});
