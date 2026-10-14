import { upcoming } from '../helpers/dates.js';
import { linkTokenIn, startHarness, type Harness } from '../helpers/harness.js';

// The whole journey, through the public and admin APIs the way the pages use
// them, with the emails read the way the people would (acceptance criteria 1, 9
// and 10, #83): book, pay, send proof, be confirmed, and cancel.

const PDF = Buffer.from('%PDF-1.4\n%proof of payment\n');
const CLIENT = {
  clientName: 'Sarah Mokoena',
  clientEmail: 'sarah.e2e@example.com',
  clientPhone: '082 555 0199',
  notes: 'Birthday makeup',
};

describe('End to end', () => {
  let h: Harness;
  let date: string;

  beforeAll(async () => {
    h = await startHarness('e2e');
    date = upcoming(3); // a Wednesday, a week or more ahead
  });
  beforeEach(() => h.reset());
  afterEach(async () => {
    // Emails are sent in the background after some answers
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
      .deleteFrom('payment_proofs')
      .where('booking_id', 'in', mine)
      .execute();
    await h.db
      .deleteFrom('bookings')
      .where('service_id', '=', h.service.id)
      .execute();
  });
  afterAll(() => h.close());

  // What a client does: choose a service, a day and a time, and give details
  async function book(time = '09:00') {
    const services = await h.http().get('/api/services');
    expect(services.status).toBe(200);
    const service = services.body.services.find(
      (s: { id: string }) => s.id === h.service.id,
    );
    expect(service).toMatchObject({ price: '650.00', depositAmount: '325.00' });

    const day = await h
      .http()
      .get(`/api/availability?serviceId=${service.id}&date=${date}`);
    expect(day.status).toBe(200);
    const slot = day.body.slots.find(
      (s: { localTime: string }) => s.localTime === time,
    );
    expect(slot, `${time} is offered on ${date}`).toBeDefined();

    const created = await h
      .http()
      .post('/api/bookings')
      .send({ serviceId: service.id, startAt: slot.startAt, ...CLIENT });
    return { created, slot };
  }

  const offered = async (time: string) => {
    const day = await h
      .http()
      .get(`/api/availability?serviceId=${h.service.id}&date=${date}`);
    return day.body.slots.some(
      (s: { localTime: string }) => s.localTime === time,
    );
  };

  describe('book, pay, be confirmed', () => {
    it('goes from the services page to a confirmed booking', async () => {
      // 1. The client books. The booking is Pending, the time is held, nothing is confirmed
      const { created, slot } = await book();
      expect(created.status).toBe(201);
      const reference: string = created.body.booking.reference;
      expect(reference).toMatch(/^BK-\d{6,}$/);
      expect(created.body.booking).toMatchObject({
        status: 'pending',
        price: '650.00',
        depositAmount: '325.00',
        startAt: slot.startAt,
      });
      expect(created.body.emailSentTo).toBe(CLIENT.clientEmail);
      expect(await offered('09:00')).toBe(false); // held while the deposit is awaited

      // 2. The client gets payment instructions with the banking details, the
      //    reference to pay with and a private link
      const instructions = h.provider.to(CLIENT.clientEmail);
      expect(instructions).toHaveLength(1);
      expect(instructions[0].subject).toBe(
        `Your booking request ${reference}: please pay your deposit`,
      );
      expect(instructions[0].text).toContain('not confirmed yet');
      expect(instructions[0].text).toContain('1234567890'); // account number
      expect(instructions[0].text).toContain(`Reference:       ${reference}`);
      const firstToken = linkTokenIn(instructions[0].text);
      expect(firstToken).not.toBeNull();

      // 3. The owner is told about the new booking
      const ownerEmail = (
        await h.db
          .selectFrom('settings')
          .select('business_email')
          .executeTakeFirstOrThrow()
      ).business_email;
      const toOwner = h.provider.to(ownerEmail);
      expect(toOwner.map((m) => m.subject)).toEqual([
        expect.stringContaining('New booking: Sarah Mokoena'),
      ]);

      // 4. The client opens their link, sees the booking and how to pay, and uploads proof
      const page = await h.http().get(`/api/booking/${firstToken}`);
      expect(page.status).toBe(200);
      expect(page.body).toMatchObject({
        booking: {
          reference,
          status: 'pending',
          paymentStatus: 'awaiting_payment',
        },
        canUploadProof: true,
        proofsRemaining: 3,
        canCancel: true,
      });
      expect(page.body.bankingDetails.accountNumber).toBe('1234567890');
      const uploaded = await h
        .http()
        .post(`/api/booking/${firstToken}/proofs`)
        .attach('file', PDF, {
          filename: 'proof-of-payment.pdf',
          contentType: 'application/pdf',
        });
      expect(uploaded.status).toBe(201);
      expect(uploaded.body.message).toContain(
        'confirmed once the payment reflects',
      );
      // Sending a proof confirms nothing
      expect(
        (await h.http().get(`/api/booking/${firstToken}`)).body.booking.status,
      ).toBe('pending');

      // 5. The owner is told, sees it on her dashboard and opens the proof
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(h.provider.to(ownerEmail).map((m) => m.subject)).toContain(
        `Proof of payment uploaded: ${reference}, Sarah Mokoena`,
      );
      const dashboard = await h.asAdmin(h.http().get('/api/admin/dashboard'));
      expect(dashboard.body.awaitingDeposit).toBeGreaterThanOrEqual(1);
      expect(dashboard.body.proofsAwaitingReview).toBeGreaterThanOrEqual(1);
      const found = await h.asAdmin(
        h.http().get(`/api/admin/bookings?proof=received&q=${reference}`),
      );
      expect(
        found.body.items.map((b: { reference: string }) => b.reference),
      ).toEqual([reference]);
      const bookingId: string = found.body.items[0].id;
      const detail = await h.asAdmin(
        h.http().get(`/api/admin/bookings/${bookingId}`),
      );
      expect(detail.body.proofs).toHaveLength(1);
      const file = await h
        .asAdmin(
          h
            .http()
            .get(`/api/admin/payment-proofs/${detail.body.proofs[0].id}/file`),
        )
        .buffer(true);
      expect(Buffer.from(file.body as Buffer)).toEqual(PDF);

      // 6. She sees the money in her bank and confirms. Nothing earlier confirmed it
      const confirmed = await h.asAdmin(
        h
          .http()
          .post(`/api/admin/bookings/${bookingId}/confirm-payment`)
          .send({ amountReceived: '325.00' }),
      );
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.booking).toMatchObject({
        status: 'confirmed',
        paymentStatus: 'confirmed',
        amountReceived: '325.00',
        paymentVerifiedBy: h.admin.id,
      });
      expect(confirmed.body.emailSentTo).toBe(CLIENT.clientEmail);

      // 7. The client gets the confirmation, with a new link; the old one is dead
      const toClient = h.provider.to(CLIENT.clientEmail);
      expect(toClient).toHaveLength(2);
      const confirmation = toClient[1];
      expect(confirmation.subject).toMatch(/^You're booked! .* on /);
      expect(confirmation.text).toContain(
        'your deposit of R325 has been received',
      );
      expect(confirmation.text).toContain(
        'The balance of R325 is payable on the day',
      );
      const secondToken = linkTokenIn(confirmation.text);
      expect(secondToken).not.toBeNull();
      expect(secondToken).not.toBe(firstToken);
      expect((await h.http().get(`/api/booking/${firstToken}`)).status).toBe(
        404,
      );
      const confirmedPage = await h.http().get(`/api/booking/${secondToken}`);
      expect(confirmedPage.status).toBe(200);
      expect(confirmedPage.body).toMatchObject({
        booking: { status: 'confirmed', paymentStatus: 'confirmed' },
        canUploadProof: false,
        bankingDetails: null,
      });
      expect(confirmedPage.body.cancellation.refundEligible).toBe(true);

      // 8. The client's own lookup agrees, and the time stays taken
      const lookup = await h
        .http()
        .post(`/api/bookings/${reference}/lookup`)
        .send({ email: CLIENT.clientEmail });
      expect(lookup.body.booking).toMatchObject({
        status: 'confirmed',
        paymentStatus: 'confirmed',
      });
      expect(await offered('09:00')).toBe(false);

      // 9. Everything that was emailed was recorded, and nothing leaked a link
      const sent = await h.db
        .selectFrom('notifications')
        .select(['type', 'status'])
        .where('booking_id', '=', bookingId)
        .execute();
      expect(sent.map((n) => n.type).sort()).toEqual(
        [
          'admin_new_booking',
          'admin_proof_uploaded',
          'booking_confirmed',
          'payment_instructions',
        ].sort(),
      );
      expect(sent.every((n) => n.status === 'sent')).toBe(true);
      for (const email of h.provider.to(ownerEmail)) {
        expect(email.text).not.toMatch(/\/booking\/[\w-]{43}/);
      }
    });

    it('lets the owner turn a proof down, and the client send another', async () => {
      const { created } = await book('09:00');
      const reference: string = created.body.booking.reference;
      const token = linkTokenIn(
        h.provider.to(CLIENT.clientEmail)[0].text,
      ) as string;
      await h
        .http()
        .post(`/api/booking/${token}/proofs`)
        .attach('file', PDF, { filename: 'blurry.pdf' });

      const detail = await h.asAdmin(
        h.http().get(`/api/admin/bookings?q=${reference}`),
      );
      const bookingId: string = detail.body.items[0].id;
      const proofId: string = (
        await h.asAdmin(h.http().get(`/api/admin/bookings/${bookingId}`))
      ).body.proofs[0].id;
      const rejected = await h
        .asAdmin(h.http().patch(`/api/admin/payment-proofs/${proofId}`))
        .send({
          status: 'rejected',
          rejectionReason: 'The amount does not match the deposit.',
        });
      expect(rejected.status).toBe(200);

      // The client is told why, without a link, and what is still owed
      const note = h.provider.to(CLIENT.clientEmail).at(-1)!;
      expect(note.subject).toBe(
        `Please check your proof of payment for ${reference}`,
      );
      expect(note.text).toContain('The amount does not match the deposit.');
      expect(note.text).not.toMatch(/\/booking\/[\w-]{43}/);

      // They see it on their page and send a better one with the link they already have
      const page = await h.http().get(`/api/booking/${token}`);
      expect(page.body.booking.paymentStatus).toBe('proof_rejected');
      expect(page.body.booking.proofs[0]).toMatchObject({
        status: 'rejected',
        rejectionReason: 'The amount does not match the deposit.',
      });
      expect(
        (
          await h
            .http()
            .post(`/api/booking/${token}/proofs`)
            .attach('file', Buffer.concat([PDF, Buffer.from('2')]), {
              filename: 'better.pdf',
            })
        ).status,
      ).toBe(201);
      expect(
        (await h.http().get(`/api/booking/${token}`)).body.booking
          .paymentStatus,
      ).toBe('proof_received');
    });
  });

  describe('book, then cancel through the link', () => {
    it('reopens the time for someone else', async () => {
      const { created } = await book('09:00');
      expect(created.status).toBe(201);
      expect(await offered('09:00')).toBe(false);
      const token = linkTokenIn(
        h.provider.to(CLIENT.clientEmail)[0].text,
      ) as string;

      // The client opens the link: it shows what cancelling means, and changes nothing
      const page = await h.http().get(`/api/booking/${token}`);
      expect(page.body.cancellation.explanation).toContain(
        "hasn't been confirmed yet",
      );
      expect(await offered('09:00')).toBe(false);

      // They confirm on the page: the booking is cancelled and the time is free
      const cancelled = await h.http().post(`/api/booking/${token}/cancel`);
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toMatchObject({
        booking: { status: 'cancelled' },
        refundDue: false,
      });
      expect(await offered('09:00')).toBe(true);

      // Both are told; the link no longer works
      expect(h.provider.to(CLIENT.clientEmail).at(-1)!.subject).toBe(
        `Your booking ${created.body.booking.reference} has been cancelled`,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(
        h.provider.sent.some((m) =>
          m.subject.startsWith('Cancelled: Sarah Mokoena'),
        ),
      ).toBe(true);
      expect((await h.http().get(`/api/booking/${token}`)).status).toBe(404);

      // Someone else books the very same time
      const second = await h.http().post('/api/bookings').send({
        serviceId: h.service.id,
        startAt: created.body.booking.startAt,
        clientName: 'Naledi Khumalo',
        clientEmail: 'naledi.e2e@example.com',
        clientPhone: '082 555 0200',
      });
      expect(second.status).toBe(201);
      expect(await offered('09:00')).toBe(false);
    });

    it('refunds a confirmed booking cancelled in time, and the owner records it', async () => {
      const { created } = await book('09:00');
      const reference: string = created.body.booking.reference;
      const first = linkTokenIn(
        h.provider.to(CLIENT.clientEmail)[0].text,
      ) as string;
      await h
        .http()
        .post(`/api/booking/${first}/proofs`)
        .attach('file', PDF, { filename: 'p.pdf' });
      const bookingId: string = (
        await h.asAdmin(h.http().get(`/api/admin/bookings?q=${reference}`))
      ).body.items[0].id;
      await h.asAdmin(
        h
          .http()
          .post(`/api/admin/bookings/${bookingId}/confirm-payment`)
          .send({ amountReceived: '325.00' }),
      );
      const token = linkTokenIn(
        h.provider.to(CLIENT.clientEmail).at(-1)!.text,
      ) as string;

      const cancelled = await h.http().post(`/api/booking/${token}/cancel`);
      expect(cancelled.body).toMatchObject({
        refundDue: true,
        refundAmount: '325.00',
      });
      expect(await offered('09:00')).toBe(true);
      expect(h.provider.to(CLIENT.clientEmail).at(-1)!.text).toContain(
        'Your deposit of R325 will be refunded',
      );

      // It shows as a refund still to pay, until the owner records it
      const due = await h.asAdmin(
        h.http().get(`/api/admin/bookings?refund=due&q=${reference}`),
      );
      expect(due.body.total).toBe(1);
      expect(
        (await h.asAdmin(h.http().get('/api/admin/dashboard'))).body.refundsDue,
      ).toBeGreaterThanOrEqual(1);
      const paid = await h.asAdmin(
        h.http().post(`/api/admin/bookings/${bookingId}/refund`),
      );
      expect(paid.status).toBe(200);
      expect(paid.body.booking.refundedAt).not.toBeNull();
      expect(
        (
          await h.asAdmin(
            h.http().get(`/api/admin/bookings?refund=due&q=${reference}`),
          )
        ).body.total,
      ).toBe(0);
    });
  });

  describe('when a time is wanted by two people', () => {
    it('gives it to the first and tells the second to choose another', async () => {
      const { slot } = await book('13:00');
      const body = (n: number) => ({
        serviceId: h.service.id,
        startAt: slot.startAt,
        clientName: `Rival ${n}`,
        clientEmail: `rival${n}.e2e@example.com`,
        clientPhone: `082 555 03${n}0`,
      });
      const [a, b] = await Promise.all([
        h.http().post('/api/bookings').send(body(1)),
        h.http().post('/api/bookings').send(body(2)),
      ]);
      // book() already holds this time, so both rivals are turned away
      const statuses = [a.status, b.status];
      expect(statuses.every((s) => s === 409)).toBe(true);
      expect(a.body.code).toBe('SLOT_UNAVAILABLE');
    });
  });
});
