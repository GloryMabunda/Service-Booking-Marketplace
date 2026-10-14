import { randomBytes } from 'node:crypto';
import {
  linkTokenIn,
  sha256,
  startHarness,
  type Harness,
} from '../helpers/harness.js';

// The booking link behaves as BR-15 says (#80): opening it never changes
// anything, every link that doesn't work gets the very same answer, a link
// opens only its own booking, and nothing can be cancelled once the
// appointment has started.

const PDF = Buffer.from('%PDF-1.4\n%proof\n');

describe('Booking link security', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness('linksec');
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
      .deleteFrom('payment_proofs')
      .where('booking_id', 'in', mine)
      .execute();
    await h.db
      .deleteFrom('bookings')
      .where('service_id', '=', h.service.id)
      .execute();
  });
  afterAll(() => h.close());

  const api = (token: string) => `/api/booking/${token}`;
  const view = (token: string) => h.http().get(api(token));
  const cancel = (token: string) => h.http().post(`${api(token)}/cancel`);
  const upload = (token: string) =>
    h
      .http()
      .post(`${api(token)}/proofs`)
      .attach('file', PDF, { filename: 'p.pdf' });

  // Everything about a booking that opening a link must leave alone
  async function state(bookingId: string) {
    const booking = await h.getBooking(bookingId);
    const proofs = await h.db
      .selectFrom('payment_proofs')
      .select('id')
      .where('booking_id', '=', bookingId)
      .execute();
    const notifications = await h.db
      .selectFrom('notifications')
      .select('id')
      .where('booking_id', '=', bookingId)
      .execute();
    return {
      booking,
      proofs: proofs.length,
      notifications: notifications.length,
      emails: h.provider.sent.length,
    };
  }

  describe('opening a link never changes anything', () => {
    it.each(['pending', 'confirmed'] as const)(
      'for a %s booking',
      async (status) => {
        const { booking, token } = await h.makeBooking({ status });
        const before = await state(booking.id);
        for (let i = 0; i < 3; i++) {
          expect((await view(token)).status).toBe(200);
          expect((await h.http().get(`/booking/${token}`)).status).toBe(200);
          // The address an email scanner might also fetch
          expect((await h.http().get(`${api(token)}/cancel`)).status).toBe(404);
          expect((await h.http().get(`${api(token)}/proofs`)).status).toBe(404);
          expect((await h.http().head(api(token))).status).toBeLessThan(500);
          expect((await h.http().options(api(token))).status).toBeLessThan(500);
        }
        expect(await state(booking.id)).toEqual(before);
      },
    );

    it('also when the link is followed with a cross-site referrer', async () => {
      const { booking, token } = await h.makeBooking();
      const before = await state(booking.id);
      await view(token)
        .set('Referer', 'https://mail.example.com/inbox')
        .set('Sec-Fetch-Site', 'cross-site');
      expect(await state(booking.id)).toEqual(before);
    });
  });

  describe('a link that does not work', () => {
    it('gives one identical answer, whatever the reason', async () => {
      const unknown = randomBytes(32).toString('base64url');
      const expired = await h.makeBooking({ status: 'expired' });
      const cancelled = await h.makeBooking({ status: 'cancelled' });
      const completed = await h.makeBooking({ status: 'completed' });
      const started = new Date(Date.now() - 3_600_000);
      const past = await h.makeBooking({
        status: 'confirmed',
        start_at: started,
        end_at: new Date(started.getTime() + 60_000),
        occupied_until: new Date(started.getTime() + 120_000),
      });
      // A link replaced by a newer one
      const replaced = await h.makeBooking();
      await h.db
        .updateTable('bookings')
        .set({ booking_token_hash: sha256('a newer link'.padEnd(43, 'n')) })
        .where('id', '=', replaced.booking.id)
        .execute();
      // A link that was never issued (no link at all)
      const none = await h.makeBooking();
      await h.db
        .updateTable('bookings')
        .set({ booking_token_hash: null, booking_token_created_at: null })
        .where('id', '=', none.booking.id)
        .execute();

      const tokens = [
        unknown,
        expired.token,
        cancelled.token,
        completed.token,
        past.token,
        replaced.token,
        none.token,
        // shapes that can't be a link
        'short',
        'x'.repeat(42),
        'x'.repeat(44),
        'x'.repeat(500),
        '../../etc/passwd',
        '%00%00',
        'a'.repeat(43).replace(/a/, '*'),
      ];
      const seen = new Set<string>();
      for (const token of tokens) {
        for (const send of [view, cancel, upload]) {
          // Each call is one probe: don't let the rate limit answer instead
          await h.reset();
          const res = await send(encodeURIComponent(token));
          expect(res.status, token).toBe(404);
          seen.add(
            JSON.stringify({
              body: res.body,
              type: res.headers['content-type'],
              referrer: res.headers['referrer-policy'],
              cache: res.headers['cache-control'],
            }),
          );
        }
      }
      expect(seen.size).toBe(1);
      expect([...seen][0]).toContain('LINK_NOT_VALID');
    });

    it('does not say whether the booking exists, is cancelled or has started', async () => {
      const { token } = await h.makeBooking({ status: 'cancelled' });
      const res = await view(token);
      const text = JSON.stringify(res.body).toLowerCase();
      for (const word of [
        'cancel',
        'expired',
        'started',
        'complete',
        'BK-',
        'reference',
      ]) {
        expect(text).not.toContain(word.toLowerCase());
      }
    });
  });

  describe('a link regenerated by the owner or the client', () => {
    it('stops the old one and starts the new one', async () => {
      const { booking, token: oldToken } = await h.makeBooking();
      const res = await h.asAdmin(
        h.http().post(`/api/admin/bookings/${booking.id}/booking-link`),
      );
      expect(res.status).toBe(202);
      const newToken = linkTokenIn(
        h.provider.to(booking.client_email)[0].text,
      ) as string;
      expect(newToken).not.toBe(oldToken);
      expect((await view(oldToken)).status).toBe(404);
      expect((await cancel(oldToken)).status).toBe(404);
      expect((await upload(oldToken)).status).toBe(404);
      expect((await view(newToken)).status).toBe(200);
    });
  });

  describe('a link opens only its own booking', () => {
    it('shows one booking and nothing about another', async () => {
      const a = await h.makeBooking({ client_name: 'Alice Anderson' });
      const b = await h.makeBooking({ client_name: 'Bella Brown' });
      const body = JSON.stringify((await view(a.token)).body);
      expect(body).toContain(a.booking.reference);
      expect(body).not.toContain(b.booking.reference);
      expect(body).not.toContain('Bella');
      expect(body).not.toContain(b.booking.client_email);
    });

    it('cancels only its own booking', async () => {
      const a = await h.makeBooking();
      const b = await h.makeBooking();
      expect((await cancel(a.token)).status).toBe(200);
      expect((await h.getBooking(a.booking.id)).status).toBe('cancelled');
      expect((await h.getBooking(b.booking.id)).status).toBe('pending');
    });

    it('is not found by changing one character of the link', async () => {
      const { token } = await h.makeBooking();
      for (const index of [0, 10, 42]) {
        const swapped = token[index] === 'A' ? 'B' : 'A';
        const near = token.slice(0, index) + swapped + token.slice(index + 1);
        expect((await view(near)).status).toBe(404);
      }
    });

    it('is the only thing that opens a booking: the reference alone does nothing', async () => {
      const { booking } = await h.makeBooking();
      for (const path of [
        `/api/booking/${booking.reference}`,
        `/api/booking/${booking.id}`,
        `/booking/${booking.reference}/cancel`,
      ]) {
        const res = await h.http().get(path);
        expect(res.status, path).toBe(404);
      }
    });
  });

  describe('cancelling', () => {
    it('is refused once the appointment has started, and changes nothing', async () => {
      const started = new Date(Date.now() - 60_000);
      const { booking, token } = await h.makeBooking({
        status: 'confirmed',
        start_at: started,
        end_at: new Date(started.getTime() + 90 * 60_000),
        occupied_until: new Date(started.getTime() + 150 * 60_000),
      });
      const before = await state(booking.id);
      const res = await cancel(token);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('LINK_NOT_VALID');
      expect(await state(booking.id)).toEqual(before);
      expect((await h.getBooking(booking.id)).status).toBe('confirmed');
    });

    it('is refused at the very moment the appointment starts', async () => {
      const { booking, token } = await h.makeBooking({
        start_at: new Date(Date.now() - 1),
        end_at: new Date(Date.now() + 90 * 60_000),
        occupied_until: new Date(Date.now() + 150 * 60_000),
      });
      expect((await cancel(token)).status).toBe(404);
      expect((await h.getBooking(booking.id)).status).toBe('pending');
    });

    it('works up to the last minute before the start', async () => {
      const soon = new Date(Date.now() + 60_000);
      const { booking, token } = await h.makeBooking({
        start_at: soon,
        end_at: new Date(soon.getTime() + 90 * 60_000),
        occupied_until: new Date(soon.getTime() + 150 * 60_000),
      });
      expect((await cancel(token)).status).toBe(200);
      expect((await h.getBooking(booking.id)).status).toBe('cancelled');
    });

    it('needs a POST: no GET, HEAD or a link scanner can cancel', async () => {
      const { booking, token } = await h.makeBooking();
      for (const method of [
        'get',
        'head',
        'options',
        'put',
        'patch',
        'delete',
      ] as const) {
        const res = await h.http()[method](`${api(token)}/cancel`);
        expect(res.status, method).toBeGreaterThanOrEqual(400);
      }
      expect((await h.getBooking(booking.id)).status).toBe('pending');
    });

    it('cannot be done twice, and the second try learns nothing', async () => {
      const { token } = await h.makeBooking();
      expect((await cancel(token)).status).toBe(200);
      const again = await cancel(token);
      expect(again.status).toBe(404);
      expect(again.body.code).toBe('LINK_NOT_VALID');
    });
  });

  describe('what a link can never reveal', () => {
    it('never returns the token or its hash, in any response or record', async () => {
      const { booking, token } = await h.makeBooking();
      const responses = [
        await view(token),
        await upload(token),
        await h.http().get(`/booking/${token}`),
      ];
      for (const res of responses) {
        expect(
          JSON.stringify(res.body ?? '') + String(res.text ?? ''),
        ).not.toContain(token);
      }
      await cancel(token);
      const notes = await h.db
        .selectFrom('notifications')
        .selectAll()
        .where('booking_id', '=', booking.id)
        .execute();
      expect(JSON.stringify(notes)).not.toContain(token);
      expect(JSON.stringify(h.provider.sent)).not.toContain(token);
    });

    it('keeps the link out of referrers, caches and search engines', async () => {
      const { token } = await h.makeBooking();
      for (const res of [
        await view(token),
        await h.http().get(`/booking/${token}`),
      ]) {
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['cache-control']).toBe('no-store');
      }
      expect(
        (await h.http().get(`/booking/${token}`)).headers['x-robots-tag'],
      ).toBe('noindex');
    });
  });
});
