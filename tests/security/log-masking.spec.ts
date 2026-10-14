import { Logger } from '@nestjs/common';
import { linkTokenIn, startHarness, type Harness } from '../helpers/harness.js';

// What the app writes to its log never contains a booking link, a client's
// details, a password or a session (#85, spec section 9). A whole journey is
// run with the log captured, and every line is read.

describe('Logging', () => {
  let h: Harness;
  let lines: string[];
  const capture = {
    log: (message: unknown) => void lines.push(String(message)),
    error: (message: unknown) => void lines.push(String(message)),
    warn: (message: unknown) => void lines.push(String(message)),
    debug: (message: unknown) => void lines.push(String(message)),
    verbose: (message: unknown) => void lines.push(String(message)),
    fatal: (message: unknown) => void lines.push(String(message)),
  };

  beforeAll(async () => {
    h = await startHarness('logmask');
  });
  beforeEach(async () => {
    await h.reset();
    lines = [];
    Logger.overrideLogger(capture);
  });
  afterEach(() => {
    Logger.overrideLogger(false);
  });
  afterAll(() => h.close());

  const PDF = Buffer.from('%PDF-1.4\n%proof\n');

  it('writes request lines at all, so the checks below mean something', async () => {
    await h.http().get('/api/services');
    expect(lines.some((l) => /GET \/api\/services 200 \d+ms/.test(l))).toBe(
      true,
    );
  });

  it('never holds a booking link, however the link is used', async () => {
    const { token } = await h.makeBooking();
    await h.http().get(`/booking/${token}`);
    await h.http().get(`/api/booking/${token}`);
    await h
      .http()
      .post(`/api/booking/${token}/proofs`)
      .attach('file', PDF, { filename: 'p.pdf' });
    await h.http().post(`/api/booking/${token}/cancel`);
    await h.http().get(`/api/booking/${token}/anything?x=1`);
    expect(lines.length).toBeGreaterThan(4);
    for (const line of lines) expect(line).not.toContain(token);
    // The address is logged, with the link blanked out
    expect(lines.some((l) => l.includes('/api/booking/***/proofs'))).toBe(true);
    expect(lines.some((l) => l.includes('GET /booking/***'))).toBe(true);
  });

  it('never holds a link that is wrong, replaced or half-typed either', async () => {
    const guesses = [
      'x'.repeat(43),
      'short',
      `${'a'.repeat(30)}/../../etc`,
      'A'.repeat(43),
    ];
    for (const guess of guesses) await h.http().get(`/api/booking/${guess}`);
    for (const line of lines) {
      for (const guess of guesses) expect(line).not.toContain(guess);
    }
  });

  it('never holds a link that came by email, through a whole booking', async () => {
    const date = new Date(Date.now() + 9 * 86_400_000);
    // A real booking through the API: the link appears only in the email
    const services = await h.http().get('/api/services');
    const day = date.toISOString().slice(0, 10);
    const availability = await h
      .http()
      .get(`/api/availability?serviceId=${h.service.id}&date=${day}`);
    const slot = availability.body.slots?.[0];
    if (!slot) return; // a day with no slots (a weekend) has nothing to book
    const created = await h
      .http()
      .post('/api/bookings')
      .send({
        serviceId: services.body.services.find(
          (s: { id: string }) => s.id === h.service.id,
        ).id,
        startAt: slot.startAt,
        clientName: 'Log Tester',
        clientEmail: 'log.tester@example.com',
        clientPhone: '082 555 0123',
      });
    expect(created.status).toBe(201);
    const token = linkTokenIn(
      h.provider.to('log.tester@example.com')[0].text,
    ) as string;
    await h.http().get(`/api/booking/${token}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const line of lines) expect(line).not.toContain(token);
  });

  it('never holds a client’s name, email, phone or notes', async () => {
    const { booking, token } = await h.makeBooking({
      notes: 'private notes for the owner',
    });
    await h
      .http()
      .post(`/api/bookings/${booking.reference}/lookup`)
      .send({ email: booking.client_email });
    await h
      .http()
      .post(`/api/bookings/${booking.reference}/resend-booking-link`)
      .send({ email: booking.client_email });
    await h.http().post(`/api/booking/${token}/cancel`);
    await h.asAdmin(
      h
        .http()
        .get(
          `/api/admin/bookings?q=${encodeURIComponent(booking.client_email)}`,
        ),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const line of lines) {
      for (const secret of [
        booking.client_email,
        booking.client_phone,
        booking.client_name,
        'private notes',
      ]) {
        expect(line, `a log line holds ${secret}`).not.toContain(secret);
      }
    }
  });

  it('never holds a password or a session', async () => {
    const password = 'a-very-secret-password-123';
    await h
      .http()
      .post('/api/auth/login')
      .send({ email: h.admin.email, password });
    const login = await h
      .http()
      .post('/api/auth/login')
      .send({ email: h.admin.email, password: 'test-admin-password' });
    const session = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])[0]
      .split(';')[0]
      .split('=')[1];
    await h
      .http()
      .get('/api/admin/dashboard')
      .set('Cookie', `mbg_session=${session}`);
    for (const line of lines) {
      expect(line).not.toContain(password);
      expect(line).not.toContain('test-admin-password');
      expect(line).not.toContain(session);
      expect(line.toLowerCase()).not.toContain('mbg_session');
    }
  });

  it('does not put what a failed email says about the client in the log', async () => {
    h.provider.failWith = 'mailbox log.victim@example.com is full';
    const { booking, token } = await h.makeBooking();
    await h.asAdmin(
      h.http().post(`/api/admin/bookings/${booking.id}/booking-link`),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      lines.some((l) => l.includes(booking.reference) || /email/i.test(l)),
    ).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(token);
      expect(line).not.toContain(booking.client_email);
    }
  });
});
