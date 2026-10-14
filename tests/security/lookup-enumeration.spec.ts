import { startHarness, type Harness } from '../helpers/harness.js';

// The public booking lookup and resend don't reveal which bookings exist
// (section 9, #81): a wrong reference and a wrong email get exactly the same
// answer, so nobody can use them to find out who has booked.

describe('Booking lookup enumeration', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness('enum');
  });
  beforeEach(() => h.reset());
  afterEach(async () => {
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

  const lookup = (reference: string, email: string) =>
    h
      .http()
      .post(`/api/bookings/${encodeURIComponent(reference)}/lookup`)
      .send({ email });
  const resend = (reference: string, email: string) =>
    h
      .http()
      .post(
        `/api/bookings/${encodeURIComponent(reference)}/resend-booking-link`,
      )
      .send({ email });

  // What a caller could compare between two answers
  const fingerprint = (res: import('supertest').Response) =>
    JSON.stringify({
      status: res.status,
      body: res.body,
      type: res.headers['content-type'],
      cache: res.headers['cache-control'],
      cookies: res.headers['set-cookie'] ?? null,
      length: res.text.length,
    });

  it('gives the very same answer for a wrong email, a wrong reference and both wrong', async () => {
    const mine = await h.makeBooking();
    const other = await h.makeBooking();
    const a = mine.booking;
    const b = other.booking;

    const answers = new Map<string, string>();
    const tries: [string, string, string][] = [
      ['right reference, wrong email', a.reference, 'nobody@example.com'],
      ['right reference, another client’s email', a.reference, b.client_email],
      ['unknown reference, right email', 'BK-999999', a.client_email],
      ['unknown reference, wrong email', 'BK-999998', 'nobody@example.com'],
      ['another client’s reference, my email', b.reference, a.client_email],
      ['lower-case unknown reference', 'bk-999997', a.client_email],
      ['reference of the wrong shape', 'not-a-reference', a.client_email],
      ['empty-looking reference', 'BK-', a.client_email],
      ['an injection attempt', "BK-000001' OR '1'='1", a.client_email],
      ['a very long reference', `BK-${'9'.repeat(200)}`, a.client_email],
    ];
    for (const [name, reference, email] of tries) {
      await h.reset(); // one probe each: the rate limit must not answer instead
      const res = await lookup(reference, email);
      expect(res.status, name).toBe(404);
      answers.set(name, fingerprint(res));
    }
    // Every answer is the same, byte for byte
    expect(new Set(answers.values()).size).toBe(1);
    expect([...answers.values()][0]).toContain('BOOKING_NOT_FOUND');
  });

  it('says nothing in its words that points to which half was wrong', async () => {
    const { booking } = await h.makeBooking();
    const wrongEmail = await lookup(booking.reference, 'nobody@example.com');
    const text = JSON.stringify(wrongEmail.body).toLowerCase();
    for (const clue of [
      'exists',
      'found but',
      'incorrect email',
      'wrong email',
      'no such reference',
      'email does not match',
    ]) {
      expect(text).not.toContain(clue);
    }
    // It names both things, so the caller can't tell which one failed
    expect(text).toContain('reference');
    expect(text).toContain('email');
  });

  it('answers a correct pair, with email in any capitals', async () => {
    const { booking } = await h.makeBooking();
    for (const email of [
      booking.client_email,
      booking.client_email.toUpperCase(),
      `  ${booking.client_email}  `,
    ]) {
      await h.reset();
      const res = await lookup(booking.reference.toLowerCase(), email);
      expect(res.status, email).toBe(200);
      expect(res.body.booking.reference).toBe(booking.reference);
    }
  });

  it('gives one client’s details to nobody else', async () => {
    const a = await h.makeBooking({ client_name: 'Alice Anderson' });
    const b = await h.makeBooking({ client_name: 'Bella Brown' });
    const res = await lookup(a.booking.reference, a.booking.client_email);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Bella');
    expect(text).not.toContain(b.booking.reference);
    expect(text).not.toContain(b.booking.client_email);
    // and not the client's own contact details back (nobody needs them again)
    expect(text).not.toContain(a.booking.client_phone);
    expect(text).not.toContain(a.booking.client_email);
  });

  it('keeps the email out of the address', async () => {
    const { booking } = await h.makeBooking();
    // A GET with the email in the URL is not a way in at all
    for (const path of [
      `/api/bookings/${booking.reference}?email=${booking.client_email}`,
      `/api/bookings/${booking.reference}/lookup?email=${booking.client_email}`,
    ]) {
      const res = await h.http().get(path);
      expect(res.status, path).toBe(404);
    }
  });

  it('never returns the booking link, however it is asked', async () => {
    const { booking, token } = await h.makeBooking();
    const res = await lookup(booking.reference, booking.client_email);
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toMatch(/\/booking\/[\w-]{20,}/);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('token');
  });

  it('limits guessing: 10 tries per 15 minutes from one address', async () => {
    const { booking } = await h.makeBooking();
    let last = 0;
    for (let i = 0; i < 11; i++)
      last = (await lookup(booking.reference, `guess${i}@example.com`)).status;
    expect(last).toBe(429);
  });

  describe('asking for a new link', () => {
    it('gives the same answer whether or not anything matched, and does not email a stranger', async () => {
      const a = await h.makeBooking();
      const b = await h.makeBooking();
      const answers = new Set<string>();
      const tries: [string, string][] = [
        [a.booking.reference, a.booking.client_email], // a real match
        [a.booking.reference, b.booking.client_email], // right reference, someone else's email
        [a.booking.reference, 'nobody@example.com'],
        ['BK-999999', a.booking.client_email],
        ['nonsense', a.booking.client_email],
      ];
      for (const [reference, email] of tries) {
        await h.reset();
        const res = await resend(reference, email);
        expect(res.status).toBe(202);
        answers.add(fingerprint(res));
      }
      expect(answers.size).toBe(1);
    });

    it('sends the new link only to the address on the booking', async () => {
      const a = await h.makeBooking();
      const b = await h.makeBooking();
      // Someone who knows A's reference and B's email tries to get A's link sent
      await resend(a.booking.reference, b.booking.client_email);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(h.provider.sent).toHaveLength(0);

      await resend(a.booking.reference, a.booking.client_email);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(h.provider.sent.map((m) => m.to)).toEqual([
        a.booking.client_email,
      ]);
    });
  });
});
