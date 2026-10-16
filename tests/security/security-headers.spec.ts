import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from '../../src/app.factory.js';
import { startHarness, type Harness } from '../helpers/harness.js';

// The browser safety headers really are on the responses the app sends (#85),
// including answers to mistakes, and the proxy setting decides whose address
// the rate limits count.

describe('Security headers', () => {
  let h: Harness;
  // The website's files are only served by an app built the way production
  // builds it, so the pages are checked on one of those
  let site: INestApplication<App>;
  const get = (path: string) => request(site.getHttpServer()).get(path);

  beforeAll(async () => {
    h = await startHarness('sechead');
    site = await createApp<INestApplication<App>>({ logger: false });
    await site.init();
  });
  beforeEach(() => h.reset());
  afterAll(async () => {
    await site.close();
    await h.close();
  });

  const directive = (policy: string, name: string) =>
    policy
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${name} `));

  describe('on every kind of response', () => {
    const token = randomBytes(32).toString('base64url');
    const paths: [string, number | null][] = [
      ['/', 200],
      ['/services.html', 200],
      ['/lookup.html', 200],
      ['/admin/', 200],
      ['/admin/login.html', 200],
      ['/js/home-page.js', 200],
      ['/css/site.css', 200],
      ['/images/brand/favicon-64.png', 200],
      ['/this-page-does-not-exist.html', 404],
      ['/api/services', 200],
      ['/api/site', 200],
      ['/api/does-not-exist', 404],
      ['/api/admin/bookings', 401],
      [`/api/booking/${token}`, 404],
      [`/booking/${token}`, 200],
      [`/media/${'a'.repeat(64)}.webp`, 404],
    ];

    it.each(paths)('%s', async (path, status) => {
      const res = await get(path);
      if (status) expect(res.status).toBe(status);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['permissions-policy']).toContain('camera=()');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(res.headers['referrer-policy']).toBeDefined();
      expect(res.headers['content-security-policy']).toBeDefined();
      // A plain 404 is answered by Express itself, with an even stricter policy
      const csp = res.headers['content-security-policy'];
      if (csp !== "default-src 'none'") {
        expect(directive(csp, 'frame-ancestors')).toBe(
          "frame-ancestors 'none'",
        );
      }
    });

    it('does not say what the server is built with', async () => {
      for (const path of ['/', '/api/services', '/api/nope', '/admin/']) {
        const res = await get(path);
        expect(res.headers['x-powered-by'], path).toBeUndefined();
        expect(res.headers.server ?? '', path).not.toMatch(
          /express|nest|node/i,
        );
      }
    });

    it('sets no HSTS outside production (it would lock a browser out of localhost)', async () => {
      expect(
        (await get('/')).headers['strict-transport-security'],
      ).toBeUndefined();
    });
  });

  describe('the content policy', () => {
    it('lets pages run their own scripts and Bootstrap, and nothing inline', async () => {
      const csp = (await get('/')).headers['content-security-policy'];
      expect(directive(csp, 'script-src')).toBe(
        "script-src 'self' https://cdn.jsdelivr.net",
      );
      expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
      expect(directive(csp, 'object-src')).toBe("object-src 'none'");
      expect(csp).not.toContain('unsafe-eval');
      expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
    });

    it('allows no outside scripts at all on the private booking page', async () => {
      const token = randomBytes(32).toString('base64url');
      const res = await h.http().get(`/booking/${token}`);
      expect(
        directive(res.headers['content-security-policy'], 'script-src'),
      ).toBe("script-src 'self'");
      // And still says nothing about the link in what it sends on
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('allows nothing to be loaded by an API answer or a photo', async () => {
      for (const path of [
        '/api/services',
        '/api/admin/bookings',
        '/media/x.webp',
      ]) {
        const res = await h.http().get(path);
        expect(res.headers['content-security-policy'], path).toBe(
          "default-src 'none'; frame-ancestors 'none'",
        );
      }
    });

    it('is on a proof file only as the other protections: no framing, the exact type, nosniff', async () => {
      const { booking, token } = await h.makeBooking();
      await h
        .http()
        .post(`/api/booking/${token}/proofs`)
        .attach('file', Buffer.from('%PDF-1.4\nproof\n'), {
          filename: 'p.pdf',
        });
      const proof = await h.db
        .selectFrom('payment_proofs')
        .select('id')
        .where('booking_id', '=', booking.id)
        .executeTakeFirstOrThrow();
      const res = await h.asAdmin(
        h.http().get(`/api/admin/payment-proofs/${proof.id}/file`),
      );
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  });

  describe('behind a hosting proxy', () => {
    const lookupFrom = (agent: Harness, ip: string) =>
      agent
        .http()
        .post('/api/bookings/BK-000001/lookup')
        .set('X-Forwarded-For', ip)
        .send({ email: 'a@example.com' });

    it('ignores X-Forwarded-For when no proxy is declared: a caller cannot pick their own address', async () => {
      // 11 tries, each claiming a different address: still counted as one caller
      let last = 0;
      for (let i = 0; i < 11; i++)
        last = (await lookupFrom(h, `203.0.113.${i + 1}`)).status;
      expect(last).toBe(429);
    });

    describe('with TRUST_PROXY=1', () => {
      let proxied: Harness;
      beforeAll(async () => {
        // The setting is read when the app is first imported, so import it
        // again with the variable in place
        vi.resetModules();
        process.env.TRUST_PROXY = '1';
        try {
          const fresh = await import('../helpers/harness.js');
          proxied = await fresh.startHarness('secproxy');
        } finally {
          delete process.env.TRUST_PROXY;
          vi.resetModules();
        }
      });
      afterAll(() => proxied.close());

      it('counts each visitor the proxy reports separately', async () => {
        await proxied.reset();
        // One visitor uses up their 10 tries and is limited...
        let last = 0;
        for (let i = 0; i < 11; i++)
          last = (await lookupFrom(proxied, '198.51.100.7')).status;
        expect(last).toBe(429);
        // ...while another visitor behind the same proxy is not
        expect((await lookupFrom(proxied, '198.51.100.8')).status).toBe(404);
      });

      it('records the visitor’s address with a proof, not the proxy’s', async () => {
        await proxied.reset();
        const { booking, token } = await proxied.makeBooking();
        await proxied
          .http()
          .post(`/api/booking/${token}/proofs`)
          .set('X-Forwarded-For', '198.51.100.9')
          .attach('file', Buffer.from('%PDF-1.4\nproof\n'), {
            filename: 'p.pdf',
          });
        const [proof] = await proxied.db
          .selectFrom('payment_proofs')
          .select('uploaded_from_ip')
          .where('booking_id', '=', booking.id)
          .execute();
        expect(proof.uploaded_from_ip).toBe('198.51.100.9');
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
    });
  });
});
