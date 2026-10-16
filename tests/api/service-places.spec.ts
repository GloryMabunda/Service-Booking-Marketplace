import { upcoming } from '../helpers/dates.js';
import { startHarness, type Harness } from '../helpers/harness.js';

// Where a service is done: at the owner's place, at the client's place, or
// both. A cleaner, for example, only ever goes to the client.

const HOME = '1 Jacaranda Avenue, Brooklyn, Pretoria';
const NEAR = '12 Protea Road, Sunnyside, Pretoria';
const CLIENT = {
  clientName: 'Sarah Mokoena',
  clientEmail: 'sarah.places@example.com',
  clientPhone: '082 555 0166',
};

describe('Where a service is done', () => {
  let h: Harness;
  let date: string;
  let clientOnly: string;

  beforeAll(async () => {
    h = await startHarness('places');
    date = upcoming(2); // a Tuesday
    const res = await h.asAdmin(
      h.http().post('/api/admin/services').send({
        name: 'places Home Clean',
        price: '480.00',
        durationMinutes: 180,
        availableAtOurPlace: false,
        availableForTravel: true,
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    clientOnly = res.body.service.id as string;
  });

  beforeEach(async () => {
    await h.reset();
    h.distance.meters = new Map([[NEAR, 8_000]]);
    h.distance.down = false;
    await setSettings({
      homeAddress: HOME,
      travelCallOutFee: '40.00',
      travelRatePerKm: '5.00',
      travelFreeKm: 5,
      travelMaxKm: 30,
      travelChargeReturn: true,
      travelExtraMinutes: 30,
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const mine = h.db
      .selectFrom('bookings')
      .select('id')
      .where('service_id', '=', clientOnly);
    await h.db
      .deleteFrom('notifications')
      .where('booking_id', 'in', mine)
      .execute();
    await h.db
      .deleteFrom('bookings')
      .where('service_id', '=', clientOnly)
      .execute();
  });

  afterAll(async () => {
    await h.db.deleteFrom('services').where('id', '=', clientOnly).execute();
    await h.close();
  });

  async function setSettings(patch: Record<string, unknown>) {
    const res = await h.asAdmin(
      h.http().patch('/api/admin/settings').send(patch),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  const patchService = (id: string, body: Record<string, unknown>) =>
    h.asAdmin(h.http().patch(`/api/admin/services/${id}`).send(body));

  describe('setting it', () => {
    it('keeps the owner’s place as the default', async () => {
      const res = await h.asAdmin(
        h.http().post('/api/admin/services').send({
          name: 'places Default',
          price: '100.00',
          durationMinutes: 30,
        }),
      );
      expect(res.body.service).toMatchObject({
        availableAtOurPlace: true,
        availableForTravel: false,
      });
      await h.db
        .deleteFrom('services')
        .where('id', '=', res.body.service.id)
        .execute();
    });

    it('can be the client’s place only', async () => {
      const list = await h.asAdmin(h.http().get('/api/admin/services'));
      expect(
        list.body.services.find((s: { id: string }) => s.id === clientOnly),
      ).toMatchObject({ availableAtOurPlace: false, availableForTravel: true });
    });

    it('refuses a new service that is done nowhere', async () => {
      const res = await h.asAdmin(
        h.http().post('/api/admin/services').send({
          name: 'places Nowhere',
          price: '100.00',
          durationMinutes: 30,
          availableAtOurPlace: false,
          availableForTravel: false,
        }),
      );
      expect(res.status).toBe(400);
      expect(res.body.details[0].field).toBe('availableAtOurPlace');
    });

    it('refuses a change that would leave a service done nowhere', async () => {
      // Client's place only, then turning the client's place off
      const res = await patchService(clientOnly, { availableForTravel: false });
      expect(res.status).toBe(400);
      expect(res.body.details[0].field).toBe('availableAtOurPlace');
      // And the service is unchanged
      const list = await h.asAdmin(h.http().get('/api/admin/services'));
      expect(
        list.body.services.find((s: { id: string }) => s.id === clientOnly),
      ).toMatchObject({ availableAtOurPlace: false, availableForTravel: true });
    });

    it('allows moving between the three choices one switch at a time', async () => {
      expect(
        (await patchService(clientOnly, { availableAtOurPlace: true })).status,
      ).toBe(200); // both
      expect(
        (await patchService(clientOnly, { availableForTravel: false })).status,
      ).toBe(200); // our place only
      expect(
        (
          await patchService(clientOnly, {
            availableForTravel: true,
            availableAtOurPlace: false,
          })
        ).status,
      ).toBe(200); // client's place only again
    });

    it('is also kept by the database, whatever the application does', async () => {
      await expect(
        h.db
          .updateTable('services')
          .set({ available_at_our_place: false, available_for_travel: false })
          .where('id', '=', h.service.id)
          .execute(),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('what clients are shown', () => {
    it('lists both switches', async () => {
      const res = await h.http().get('/api/services');
      const service = res.body.services.find(
        (s: { id: string }) => s.id === clientOnly,
      );
      expect(service).toMatchObject({
        availableAtOurPlace: false,
        availableForTravel: true,
      });
    });
  });

  describe('booking a service done only at the client’s place', () => {
    const slots = async (location: 'studio' | 'client') =>
      h
        .http()
        .get(
          `/api/availability?serviceId=${clientOnly}&date=${date}&location=${location}`,
        );

    it('offers no times at the owner’s place, and says why', async () => {
      const res = await slots('studio');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PLACE_NOT_OFFERED');
    });

    it('offers times at the client’s place', async () => {
      const res = await slots('client');
      expect(res.status).toBe(200);
      expect(res.body.slots.length).toBeGreaterThan(0);
    });

    it('refuses a booking at the owner’s place, even one made directly', async () => {
      const day = await slots('client');
      const res = await h
        .http()
        .post('/api/bookings')
        .send({
          serviceId: clientOnly,
          startAt: day.body.slots[0].startAt,
          ...CLIENT,
          location: 'studio',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PLACE_NOT_OFFERED');
      // Leaving the place out means the owner's place, so it is refused too
      const quiet = await h
        .http()
        .post('/api/bookings')
        .send({
          serviceId: clientOnly,
          startAt: day.body.slots[0].startAt,
          ...CLIENT,
        });
      expect(quiet.body.code).toBe('PLACE_NOT_OFFERED');
    });

    it('books at the client’s place with the travel fee in the deposit', async () => {
      const day = await slots('client');
      const res = await h
        .http()
        .post('/api/bookings')
        .send({
          serviceId: clientOnly,
          startAt: day.body.slots[0].startAt,
          ...CLIENT,
          location: 'client',
          appointmentAddress: NEAR,
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      // 8 km each way, return charged: 16 km, 5 free, 11 x R5 = R55, plus R40
      expect(res.body.booking).toMatchObject({
        location: 'client',
        travelFee: '95.00',
        // 50% of R480 = R240, plus the travel fee
        depositAmount: '335.00',
      });
    });

    it('cannot be booked at all while the owner has no home address', async () => {
      await setSettings({ homeAddress: null });
      const res = await slots('client');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TRAVEL_NOT_OFFERED');
    });
  });
});
