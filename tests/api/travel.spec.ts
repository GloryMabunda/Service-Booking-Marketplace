import { upcoming } from '../helpers/dates.js';
import { linkTokenIn, startHarness, type Harness } from '../helpers/harness.js';

// Appointment location and travel fee (#115) through the real API: the
// settings and service switch, the quote, the booking with its snapshot, the
// deposit, the time blocked around a travel booking, and who gets to see which
// address.

const HOME = '1 Jacaranda Avenue, Brooklyn, Pretoria';
const NEAR = '12 Protea Road, Sunnyside, Pretoria'; // 10 km away
const FAR = '99 Karoo Road, Beaufort West'; // 400 km away
const NOWHERE = 'Nowhere Lane';
const CLIENT = {
  clientName: 'Sarah Mokoena',
  clientEmail: 'sarah.travel@example.com',
  clientPhone: '082 555 0177',
};

describe('Travel bookings', () => {
  let h: Harness;
  let date: string;

  beforeAll(async () => {
    h = await startHarness('travel');
    date = upcoming(4); // a Thursday
    await h.asAdmin(
      h
        .http()
        .patch(`/api/admin/services/${h.service.id}`)
        .send({ availableForTravel: true }),
    );
  });

  beforeEach(async () => {
    await h.reset();
    h.distance.meters = new Map([
      [NEAR, 10_000],
      [FAR, 400_000],
    ]);
    h.distance.down = false;
    h.distance.calls = 0;
    await setSettings({
      homeAddress: HOME,
      travelCallOutFee: '50.00',
      travelRatePerKm: '4.95',
      travelFreeKm: 0,
      travelMaxKm: 30,
      travelChargeReturn: true,
      travelExtraMinutes: 30,
    });
    await setServiceTravel(true);
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const mine = h.db
      .selectFrom('bookings')
      .select('id')
      .where('service_id', '=', h.service.id);
    await h.db
      .deleteFrom('notifications')
      .where('booking_id', 'in', mine)
      .execute();
    await h.db
      .deleteFrom('bookings')
      .where('service_id', '=', h.service.id)
      .execute();
  });

  afterAll(() => h.close());

  async function setSettings(patch: Record<string, unknown>) {
    const res = await h.asAdmin(
      h.http().patch('/api/admin/settings').send(patch),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res;
  }

  async function setServiceTravel(on: boolean) {
    const res = await h.asAdmin(
      h
        .http()
        .patch(`/api/admin/services/${h.service.id}`)
        .send({ availableForTravel: on }),
    );
    expect(res.status).toBe(200);
  }

  async function slot(time: string, location: 'studio' | 'client') {
    const res = await h
      .http()
      .get(
        `/api/availability?serviceId=${h.service.id}&date=${date}&location=${location}`,
      );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.slots.find(
      (s: { localTime: string }) => s.localTime === time,
    );
  }

  async function bookAt(
    time: string,
    location: 'studio' | 'client',
    extra: Record<string, unknown> = {},
  ) {
    const found = await slot(time, location);
    expect(found, `${time} is offered ${location}`).toBeDefined();
    return h
      .http()
      .post('/api/bookings')
      .send({
        serviceId: h.service.id,
        startAt: found.startAt,
        ...CLIENT,
        location,
        ...(location === 'client' ? { appointmentAddress: NEAR } : {}),
        ...extra,
      });
  }

  describe('the rules in Settings', () => {
    it('stores and returns them', async () => {
      const res = await h.asAdmin(h.http().get('/api/admin/settings'));
      expect(res.body.settings).toMatchObject({
        homeAddress: HOME,
        travelCallOutFee: '50.00',
        travelRatePerKm: '4.95',
        travelFreeKm: 0,
        travelMaxKm: 30,
        travelChargeReturn: true,
        travelExtraMinutes: 30,
      });
    });

    it.each([
      [{ travelCallOutFee: '-5' }, 'travelCallOutFee'],
      [{ travelCallOutFee: 'abc' }, 'travelCallOutFee'],
      [{ travelRatePerKm: '1.234' }, 'travelRatePerKm'],
      [{ travelFreeKm: -1 }, 'travelFreeKm'],
      [{ travelMaxKm: 0 }, 'travelMaxKm'],
      [{ travelMaxKm: 501 }, 'travelMaxKm'],
      [{ travelExtraMinutes: 241 }, 'travelExtraMinutes'],
      [{ travelChargeReturn: 'yes' }, 'travelChargeReturn'],
      [{ homeAddress: 'x'.repeat(301) }, 'homeAddress'],
    ])('refuses %j', async (patch, field) => {
      const res = await h.asAdmin(
        h.http().patch('/api/admin/settings').send(patch),
      );
      expect(res.status).toBe(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toEqual([
        field,
      ]);
    });

    it('turns travel off again when the home address is cleared', async () => {
      await setSettings({ homeAddress: null });
      const services = await h.http().get('/api/services');
      expect(services.body.travel).toBeNull();
    });
  });

  describe('what clients are shown', () => {
    it('lists the travel rules and which services can travel, without the home address', async () => {
      const res = await h.http().get('/api/services');
      expect(res.body.travel).toEqual({
        callOutFee: '50.00',
        ratePerKm: '4.95',
        freeKm: 0,
        maxKm: 30,
        chargeReturn: true,
      });
      expect(
        res.body.services.find((s: { id: string }) => s.id === h.service.id)
          .availableForTravel,
      ).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('Jacaranda');
      expect(
        JSON.stringify((await h.http().get('/api/site')).body),
      ).not.toContain('Jacaranda');
    });

    it('does not offer travel for a service that is switched off', async () => {
      await setServiceTravel(false);
      const res = await h.http().get('/api/services');
      expect(
        res.body.services.find((s: { id: string }) => s.id === h.service.id)
          .availableForTravel,
      ).toBe(false);
    });
  });

  describe('POST /api/travel/quote', () => {
    const quote = (address: string, serviceId = h.service.id) =>
      h.http().post('/api/travel/quote').send({ serviceId, address });

    it('gives the breakdown and the new deposit', async () => {
      const res = await quote(NEAR);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        travel: {
          distanceKm: '10.0',
          billedKm: '20.0',
          chargeableKm: '20.0',
          callOutFee: '50.00',
          ratePerKm: '4.95',
          kmFee: '99.00',
          travelFee: '149.00',
          freeKm: 0,
          chargeReturn: true,
        },
        price: '650.00',
        deposit: {
          servicePart: '325.00',
          travelFee: '149.00',
          deposit: '474.00',
          balance: '325.00',
        },
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('follows the settings when the owner changes them', async () => {
      await setSettings({ travelChargeReturn: false, travelFreeKm: 4 });
      const res = await quote(NEAR);
      // 10 km one way, 4 free: 6 × 4.95 = 29.70, plus 50.00
      expect(res.body.travel).toMatchObject({
        chargeableKm: '6.0',
        travelFee: '79.70',
      });
    });

    it('refuses an address beyond the maximum distance', async () => {
      const res = await quote(FAR);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TOO_FAR');
      expect(res.body.message).toContain('30 km');
    });

    it('asks the client to check an address the maps service cannot find', async () => {
      const res = await quote(NOWHERE);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
      expect(res.body.details[0].field).toBe('appointmentAddress');
    });

    it('says clearly that travel is unavailable when the maps service is down', async () => {
      h.distance.down = true;
      const res = await quote(NEAR);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('TRAVEL_UNAVAILABLE');
      expect(res.body.message).toContain('our place');
      expect(JSON.stringify(res.body)).not.toContain('Jacaranda');
    });

    it('says the same when no home address has been set', async () => {
      await setSettings({ homeAddress: null });
      expect((await quote(NEAR)).body.code).toBe('TRAVEL_UNAVAILABLE');
      expect(h.distance.calls).toBe(0);
    });

    it('refuses a service that is not offered at the client’s place', async () => {
      await setServiceTravel(false);
      const res = await quote(NEAR);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TRAVEL_NOT_OFFERED');
    });

    it('refuses an unknown service and bad input', async () => {
      expect(
        (await quote(NEAR, '00000000-0000-4000-8000-000000000000')).body.code,
      ).toBe('SERVICE_UNAVAILABLE');
      expect((await quote('x')).status).toBe(400);
      expect((await quote('y'.repeat(301))).status).toBe(400);
      const extra = await h
        .http()
        .post('/api/travel/quote')
        .send({ serviceId: h.service.id, address: NEAR, travelFee: '0.00' });
      expect(extra.status).toBe(400);
    });

    it('is limited, because each call may cost a maps request', async () => {
      let last = 0;
      for (let i = 0; i < 16; i++) last = (await quote(NEAR)).status;
      expect(last).toBe(429);
    });
  });

  describe('creating a booking at the client’s place', () => {
    it('saves the address, the distance, the fee rules and the deposit with the fee', async () => {
      const res = await bookAt('09:00', 'client');
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.booking).toMatchObject({
        location: 'client',
        appointmentAddress: NEAR,
        travelFee: '149.00',
        price: '650.00',
        depositAmount: '474.00',
        status: 'pending',
      });
      const row = await h.db
        .selectFrom('bookings')
        .selectAll()
        .where('reference', '=', res.body.booking.reference)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        location: 'client',
        appointment_address: NEAR,
        travel_distance_km: '10.0',
        travel_call_out_fee: '50.00',
        travel_rate_per_km: '4.95',
        travel_fee: '149.00',
        deposit_amount: '474.00',
      });
    });

    it('works out the fee on the server: the client cannot send their own', async () => {
      const found = await slot('09:00', 'client');
      for (const extra of [
        { travelFee: '0.00' },
        { depositAmount: '1.00' },
        { travelDistanceKm: '0.1' },
      ]) {
        const res = await h
          .http()
          .post('/api/bookings')
          .send({
            serviceId: h.service.id,
            startAt: found.startAt,
            ...CLIENT,
            location: 'client',
            appointmentAddress: NEAR,
            ...extra,
          });
        expect(res.status).toBe(400);
      }
    });

    it('keeps the fee it was booked with when the settings change later', async () => {
      const res = await bookAt('09:00', 'client');
      await setSettings({
        travelCallOutFee: '500.00',
        travelRatePerKm: '50.00',
      });
      const row = await h.db
        .selectFrom('bookings')
        .select(['travel_fee', 'deposit_amount', 'travel_call_out_fee'])
        .where('reference', '=', res.body.booking.reference)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({
        travel_fee: '149.00',
        deposit_amount: '474.00',
        travel_call_out_fee: '50.00',
      });
    });

    it('refuses an address that is too far, one that is missing, and one that cannot be found', async () => {
      const far = await bookAt('09:00', 'client', { appointmentAddress: FAR });
      expect(far.status).toBe(400);
      expect(far.body.code).toBe('TOO_FAR');

      const none = await bookAt('09:00', 'client', {
        appointmentAddress: undefined,
      });
      expect(none.status).toBe(400);
      expect(none.body.details[0].field).toBe('appointmentAddress');

      const lost = await bookAt('09:00', 'client', {
        appointmentAddress: NOWHERE,
      });
      expect(lost.body.code).toBe('ADDRESS_NOT_FOUND');
      expect(
        await h.db
          .selectFrom('bookings')
          .select('id')
          .where('service_id', '=', h.service.id)
          .execute(),
      ).toEqual([]);
    });

    it('says travel is unavailable, and saves nothing, when the maps service is down', async () => {
      const found = await slot('09:00', 'client');
      h.distance.down = true;
      const res = await h
        .http()
        .post('/api/bookings')
        .send({
          serviceId: h.service.id,
          startAt: found.startAt,
          ...CLIENT,
          location: 'client',
          appointmentAddress: NEAR,
        });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('TRAVEL_UNAVAILABLE');
      expect(
        await h.db
          .selectFrom('bookings')
          .select('id')
          .where('service_id', '=', h.service.id)
          .execute(),
      ).toEqual([]);
    });

    it('refuses the client’s place for a service that does not travel', async () => {
      const found = await slot('09:00', 'client');
      await setServiceTravel(false);
      const res = await h
        .http()
        .post('/api/bookings')
        .send({
          serviceId: h.service.id,
          startAt: found.startAt,
          ...CLIENT,
          location: 'client',
          appointmentAddress: NEAR,
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TRAVEL_NOT_OFFERED');
      expect(
        (
          await h
            .http()
            .get(
              `/api/availability?serviceId=${h.service.id}&date=${date}&location=client`,
            )
        ).body.code,
      ).toBe('TRAVEL_NOT_OFFERED');
    });

    it('refuses an address for a booking at the owner’s place', async () => {
      const res = await bookAt('09:00', 'studio', {
        appointmentAddress: NEAR,
      });
      expect(res.status).toBe(400);
    });

    it('needs no maps request for a booking at the owner’s place', async () => {
      const res = await bookAt('09:00', 'studio');
      expect(res.status).toBe(201);
      expect(res.body.booking).toMatchObject({
        location: 'studio',
        appointmentAddress: null,
        travelFee: '0.00',
        depositAmount: '325.00',
      });
      expect(h.distance.calls).toBe(0);
    });

    it('can ask for more than the service costs, because the travel fee is part of the deposit', async () => {
      await h.asAdmin(
        h
          .http()
          .patch(`/api/admin/services/${h.service.id}`)
          .send({ price: '40.00' }),
      );
      try {
        const res = await bookAt('09:00', 'client');
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        // 50% of R40 = R20, plus R149 travel
        expect(res.body.booking).toMatchObject({
          price: '40.00',
          depositAmount: '169.00',
          status: 'pending',
        });
      } finally {
        await h.asAdmin(
          h
            .http()
            .patch(`/api/admin/services/${h.service.id}`)
            .send({ price: '650.00' }),
        );
      }
    });

    it('is Pending for the travel fee alone when the deposit percentage is 0', async () => {
      await setSettings({ depositPercent: '0.00' });
      try {
        const res = await bookAt('09:00', 'client');
        expect(res.body.booking).toMatchObject({
          depositAmount: '149.00',
          status: 'pending',
        });
        const free = await bookAt('13:00', 'studio', {
          clientEmail: 'other.travel@example.com',
          clientPhone: '082 555 0178',
        });
        expect(free.body.booking.status).toBe('confirmed');
      } finally {
        await setSettings({ depositPercent: '50.00' });
      }
    });
  });

  describe('the time a travel booking blocks', () => {
    it('keeps travel time clear before and after, so back to back across town is not offered', async () => {
      // 90-minute service, 60-minute buffer. At 11:00 at the client's place:
      // blocks 10:30 to 14:00 (ends 12:30, +60 buffer, +30 travel).
      const booked = await bookAt('11:00', 'client');
      expect(booked.status, JSON.stringify(booked.body)).toBe(201);
      const row = await h.db
        .selectFrom('bookings')
        .select(['start_at', 'occupied_from', 'occupied_until'])
        .where('reference', '=', booked.body.booking.reference)
        .executeTakeFirstOrThrow();
      const minutes = (d: Date | string | null) =>
        new Date(d as Date).getTime() / 60_000;
      expect(minutes(row.start_at) - minutes(row.occupied_from)).toBe(30);
      expect(minutes(row.occupied_until) - minutes(row.start_at)).toBe(
        90 + 60 + 30,
      );

      // 09:00 at the owner's place would end 10:30 + 60 buffer = 11:30, which
      // already overlaps; 14:00 is the first free hour either way, but 13:00
      // for a travel booking would start travelling at 12:30
      expect(await slot('13:00', 'studio')).toBeUndefined();
      expect(await slot('13:00', 'client')).toBeUndefined();
      expect(await slot('14:00', 'studio')).toBeDefined();
      expect(await slot('14:00', 'client')).toBeUndefined(); // travel starts 13:30, inside
      expect(await slot('15:00', 'client')).toBeDefined();
    });

    it('lets the database refuse an overlap that includes the travel time', async () => {
      const first = await bookAt('11:00', 'client');
      expect(first.status).toBe(201);
      const { start_at } = await h.db
        .selectFrom('bookings')
        .select('start_at')
        .where('reference', '=', first.body.booking.reference)
        .executeTakeFirstOrThrow();
      const start = new Date(start_at).getTime();
      // A booking saved straight into the 30 minutes of travel before 11:00
      await expect(
        h.makeBooking({
          start_at: new Date(start - 90 * 60_000),
          end_at: new Date(start - 15 * 60_000),
          occupied_until: new Date(start - 15 * 60_000),
        }),
      ).rejects.toMatchObject({ code: '23P01' });
    });

    it('frees the travel time again when the booking is cancelled', async () => {
      const booked = await bookAt('11:00', 'client');
      const row = await h.db
        .selectFrom('bookings')
        .select('id')
        .where('reference', '=', booked.body.booking.reference)
        .executeTakeFirstOrThrow();
      expect(await slot('14:00', 'studio')).toBeDefined();
      expect(await slot('13:00', 'studio')).toBeUndefined();
      await h.asAdmin(
        h
          .http()
          .patch(`/api/admin/bookings/${row.id}/status`)
          .send({ status: 'cancelled' }),
      );
      expect(await slot('13:00', 'studio')).toBeDefined();
    });
  });

  describe('who sees which address', () => {
    it('gives the owner’s address to a client who comes to her, in their email', async () => {
      const res = await bookAt('09:00', 'studio');
      expect(res.status).toBe(201);
      const email = h.provider.to(CLIENT.clientEmail)[0];
      expect(email.text).toContain(`Where: At my place: ${HOME}`);
      expect(email.html).toContain(HOME);
      // The owner's own email does not repeat her address back to her
      expect(h.provider.to(h.provider.sent.at(-1)!.to)[0].text).toBeDefined();
    });

    it('tells a travel client the address, the fee, and the right balance', async () => {
      const res = await bookAt('09:00', 'client');
      expect(res.status).toBe(201);
      const email = h.provider.to(CLIENT.clientEmail)[0];
      expect(email.text).toContain(`Where: At your place: ${NEAR}`);
      expect(email.text).toContain('Travel fee: R149');
      expect(email.text).toContain('deposit of R474');
      // The balance is the service price less its part of the deposit: the
      // travel fee is not part of the price
      expect(email.text).toContain('balance of R325');
      expect(email.text).not.toContain(HOME);
    });

    it('tells the owner the client’s address, distance and fee', async () => {
      await bookAt('09:00', 'client');
      const owner = h.provider.sent.find((m) => m.to !== CLIENT.clientEmail)!;
      expect(owner.text).toContain(NEAR);
      expect(owner.text).toContain('10.0 km');
      expect(owner.text).toContain('Travel fee: R149');
    });

    it('shows the owner’s address on the private booking page data, never in a look-up', async () => {
      const res = await bookAt('09:00', 'studio');
      const email = h.provider.to(CLIENT.clientEmail)[0];
      const token = linkTokenIn(email.text) as string;
      const page = await h.http().get(`/api/booking/${token}`);
      expect(page.body.ownerAddress).toBe(HOME);
      expect(page.body.booking).toMatchObject({
        location: 'studio',
        appointmentAddress: null,
      });

      const lookup = await h
        .http()
        .post(`/api/bookings/${res.body.booking.reference}/lookup`)
        .send({ email: CLIENT.clientEmail });
      expect(lookup.status).toBe(200);
      expect(JSON.stringify(lookup.body)).not.toContain('Jacaranda');
    });

    it('shows a travel client their own address and no owner address', async () => {
      await bookAt('09:00', 'client');
      const token = linkTokenIn(
        h.provider.to(CLIENT.clientEmail)[0].text,
      ) as string;
      const page = await h.http().get(`/api/booking/${token}`);
      expect(page.body.ownerAddress).toBeNull();
      expect(page.body.booking).toMatchObject({
        location: 'client',
        appointmentAddress: NEAR,
        travelFee: '149.00',
      });
    });

    it('shows the owner the location in the portal and on the calendar', async () => {
      const res = await bookAt('09:00', 'client');
      const list = await h.asAdmin(
        h.http().get('/api/admin/bookings?q=' + res.body.booking.reference),
      );
      expect(list.body.items[0]).toMatchObject({
        location: 'client',
        appointmentAddress: NEAR,
        travelDistanceKm: '10.0',
        travelFee: '149.00',
        depositAmount: '474.00',
      });
      const from = date;
      const calendar = await h.asAdmin(
        h.http().get(`/api/admin/calendar?from=${from}&to=${from}`),
      );
      expect(calendar.body.events[0].location).toBe('client');
    });
  });
});
