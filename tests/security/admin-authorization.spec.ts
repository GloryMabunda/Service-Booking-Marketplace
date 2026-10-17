import { randomBytes } from 'node:crypto';
import { sha256, startHarness, type Harness } from '../helpers/harness.js';
import {
  concretePath,
  isAdminRoute,
  isMutation,
  listRoutes,
  type Route,
} from '../helpers/routes.js';
import { errorBody } from '../helpers/http.js';

// Every /api/admin route refuses anyone who isn't a signed-in administrator
// (A-1, acceptance criterion 6, #79). The tests are generated from the routes
// the running app really has, so a new admin route is covered the moment it is
// added, with nobody having to remember to write a test for it.

// The routes anyone may call. A new route outside /api/admin has to be added
// here on purpose: that is the point where "should this be public?" is asked.
const PUBLIC_ROUTES = [
  'GET /api/availability',
  'GET /api/booking/:token',
  'GET /api/services',
  'GET /api/site',
  'GET /booking/:token',
  'GET /media/:file',
  'POST /api/auth/login',
  'POST /api/booking/:token/cancel',
  'POST /api/booking/:token/proofs',
  'POST /api/bookings',
  'POST /api/travel/quote',
  'GET /api/health',
  'GET /api/brand',
  'GET /api/demo/emails',
  'POST /api/bookings/find-links',
  'POST /api/bookings/:reference/lookup',
  'POST /api/bookings/:reference/resend-booking-link',
];
// Routes outside /api/admin that still need a session
const SIGNED_IN_ROUTES = ['GET /api/auth/me', 'POST /api/auth/logout'];

describe('Admin authorization', () => {
  let h: Harness;
  let routes: Route[];
  let adminRoutes: Route[];

  beforeAll(async () => {
    h = await startHarness('authz');
    routes = listRoutes(h.app);
    adminRoutes = routes.filter(isAdminRoute);
  });
  beforeEach(() => h.reset());
  afterAll(() => h.close());

  const call = (route: Route, headers: Record<string, string> = {}) => {
    const path = concretePath(route.path);
    let r = h.http()[route.method.toLowerCase() as 'get'](path);
    for (const [name, value] of Object.entries(headers)) r = r.set(name, value);
    // A body for the routes that take one, so refusal can't be down to a missing body
    return isMutation(route) ? r.send({}) : r;
  };

  describe('the route list', () => {
    it('finds the admin routes, so the tests below are not empty', () => {
      expect(adminRoutes.length).toBeGreaterThanOrEqual(40);
      expect(adminRoutes.map((r) => r.path)).toEqual(
        expect.arrayContaining([
          '/api/admin/bookings',
          '/api/admin/settings',
          '/api/admin/payment-proofs/:id/file',
          '/api/admin/gallery',
        ]),
      );
    });

    it('knows every route outside /api/admin, so a new public route is a conscious choice', () => {
      const others = routes
        .filter((r) => !isAdminRoute(r))
        .map((r) => `${r.method} ${r.path}`)
        .sort();
      expect(others).toEqual([...PUBLIC_ROUTES, ...SIGNED_IN_ROUTES].sort());
    });
  });

  describe('without a session', () => {
    it('refuses every admin route with 401 and the standard error', async () => {
      for (const route of adminRoutes) {
        const res = await call(route);
        const where = `${route.method} ${route.path}`;
        expect(res.status, where).toBe(401);
        expect(errorBody(res), where).toEqual({
          statusCode: 401,
          code: 'UNAUTHENTICATED',
          message: 'Please sign in.',
          details: null,
        });
      }
    });

    it('does nothing: no admin route changes data for a visitor', async () => {
      const before = await snapshot(h);
      for (const route of adminRoutes) await call(route);
      expect(await snapshot(h)).toEqual(before);
    });

    it('refuses the signed-in routes outside /api/admin too', async () => {
      for (const text of SIGNED_IN_ROUTES) {
        const [method, path] = text.split(' ');
        const res = await h.http()[method.toLowerCase() as 'get'](path);
        expect(res.status, text).toBe(401);
      }
    });
  });

  describe('with a session that is not good', () => {
    const bad: [string, () => Record<string, string>][] = [
      [
        'a made-up cookie',
        () => ({ Cookie: 'mbg_session=not-a-real-session' }),
      ],
      [
        'a well-formed cookie nobody was given',
        () => ({
          Cookie: `mbg_session=${randomBytes(32).toString('base64url')}`,
        }),
      ],
      ['an empty cookie', () => ({ Cookie: 'mbg_session=' })],
      [
        'the right value under the wrong cookie name',
        () => ({
          Cookie: h.admin.cookie.replace('mbg_session', 'session'),
        }),
      ],
      [
        'a bearer token instead of the cookie',
        () => ({
          Authorization: `Bearer ${h.admin.cookie.split('=')[1]}`,
        }),
      ],
      [
        'the session id in a header',
        () => ({ 'X-Session': h.admin.cookie.split('=')[1] }),
      ],
    ];

    it.each(bad)(
      'refuses every admin route with %s',
      async (_name, headers) => {
        const extra = headers();
        for (const route of adminRoutes) {
          const res = await call(route, extra);
          expect(res.status, `${route.method} ${route.path}`).toBe(401);
        }
      },
    );

    it('refuses a session that has expired', async () => {
      await h.db
        .updateTable('sessions')
        .set({
          expires_at: new Date(Date.now() - 1000),
          created_at: new Date(Date.now() - 2000),
        })
        .execute();
      for (const route of adminRoutes) {
        expect((await call(route, { Cookie: h.admin.cookie })).status).toBe(
          401,
        );
      }
      await restoreSession(h);
    });

    it('refuses a session after the owner signed out', async () => {
      const cookie = await signInAgain(h);
      expect(
        (await h.http().get('/api/auth/me').set('Cookie', cookie)).status,
      ).toBe(200);
      await h.http().post('/api/auth/logout').set('Cookie', cookie);
      for (const route of adminRoutes) {
        expect((await call(route, { Cookie: cookie })).status, route.path).toBe(
          401,
        );
      }
    });

    it('refuses a session whose user no longer exists', async () => {
      const cookie = await signInAgain(h);
      const token = cookie.split('=')[1];
      const row = await h.db
        .selectFrom('sessions')
        .select('user_id')
        .where('token_hash', '=', sha256(token))
        .executeTakeFirstOrThrow();
      expect(row.user_id).toBeDefined();
      await h.db
        .deleteFrom('sessions')
        .where('token_hash', '=', sha256(token))
        .execute();
      expect((await call(adminRoutes[0], { Cookie: cookie })).status).toBe(401);
    });
  });

  describe('with a good session', () => {
    it('lets every admin route through the guard (what it answers is up to the route)', async () => {
      // A fresh session: an earlier test signed the owner out
      const cookie = await signInAgain(h);
      for (const route of adminRoutes) {
        const res = await call(route, { Cookie: cookie });
        expect([401, 403], `${route.method} ${route.path}`).not.toContain(
          res.status,
        );
      }
    });
  });

  // Each test here makes hundreds of requests, so it is given longer than 5 s
  describe('how often one session may ask', { timeout: 30_000 }, () => {
    it('allows 300 requests a minute, then 429 with the RateLimit headers', async () => {
      const cookie = await signInAgain(h);
      let last = await h
        .http()
        .get('/api/admin/dashboard')
        .set('Cookie', cookie);
      expect(last.headers['ratelimit-limit']).toBe('300');
      for (let i = 1; i < 300; i++) {
        last = await h.http().get('/api/admin/dashboard').set('Cookie', cookie);
      }
      expect(last.status).toBe(200);
      expect(last.headers['ratelimit-remaining']).toBe('0');
      const over = await h
        .http()
        .get('/api/admin/dashboard')
        .set('Cookie', cookie);
      expect(over.status).toBe(429);
      expect(over.body.code).toBe('RATE_LIMITED');
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('counts each session on its own', async () => {
      const first = await signInAgain(h);
      for (let i = 0; i < 300; i++) {
        await h.http().get('/api/admin/dashboard').set('Cookie', first);
      }
      expect(
        (await h.http().get('/api/admin/dashboard').set('Cookie', first))
          .status,
      ).toBe(429);
      // Signing in again gives a different session, with its own count
      const second = await signInAgain(h);
      expect(
        (await h.http().get('/api/admin/dashboard').set('Cookie', second))
          .status,
      ).toBe(200);
    });

    it('does not count requests from a visitor with no session against anyone', async () => {
      for (let i = 0; i < 305; i++) await h.http().get('/api/admin/dashboard');
      const cookie = await signInAgain(h);
      expect(
        (await h.http().get('/api/admin/dashboard').set('Cookie', cookie))
          .status,
      ).toBe(200);
    });
  });

  describe('requests started by another website', () => {
    const changes = () => adminRoutes.filter(isMutation);

    it('refuses every admin change the browser says came from another site', async () => {
      for (const route of changes()) {
        const res = await call(route, {
          Cookie: h.admin.cookie,
          'Sec-Fetch-Site': 'cross-site',
        });
        expect(res.status, `${route.method} ${route.path}`).toBe(403);
        expect(errorBody(res).code).toBe('FORBIDDEN');
      }
    });

    it('refuses an admin change with another site as its origin', async () => {
      for (const route of changes()) {
        const res = await call(route, {
          Cookie: h.admin.cookie,
          Origin: 'https://evil.example',
        });
        expect(res.status, `${route.method} ${route.path}`).toBe(403);
      }
    });

    it('lets the site itself through', async () => {
      const route = changes()[0];
      const res = await call(route, {
        Cookie: await signInAgain(h),
        'Sec-Fetch-Site': 'same-origin',
      });
      expect(res.status).not.toBe(403);
    });
  });

  describe('the session cookie', () => {
    it('is HttpOnly and SameSite=Strict', async () => {
      const res = await h
        .http()
        .post('/api/auth/login')
        .send({ email: h.admin.email, password: 'test-admin-password' });
      const cookie = ([] as string[])
        .concat(res.headers['set-cookie'] ?? [])
        .join(';');
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
    });
  });
});

// What the database holds that a visitor must not be able to change
async function snapshot(h: Harness) {
  const count = async (
    table:
      | 'bookings'
      | 'services'
      | 'settings'
      | 'site_content'
      | 'gallery_items'
      | 'testimonials'
      | 'faqs'
      | 'blocked_times'
      | 'notifications',
  ) =>
    Number(
      (
        await h.db
          .selectFrom(table)
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );
  const settings = await h.db
    .selectFrom('settings')
    .selectAll()
    .executeTakeFirstOrThrow();
  return {
    bookings: await count('bookings'),
    services: await count('services'),
    site_content: await count('site_content'),
    gallery: await count('gallery_items'),
    testimonials: await count('testimonials'),
    faqs: await count('faqs'),
    blocked: await count('blocked_times'),
    notifications: await count('notifications'),
    settingsUpdated: settings.updated_at,
    serviceNames: (
      await h.db.selectFrom('services').select('name').orderBy('name').execute()
    ).map((s) => s.name),
  };
}

async function signInAgain(h: Harness): Promise<string> {
  const res = await h
    .http()
    .post('/api/auth/login')
    .send({ email: h.admin.email, password: 'test-admin-password' })
    .expect(200);
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('mbg_session='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0];
}

async function restoreSession(h: Harness) {
  await h.db
    .updateTable('sessions')
    .set({
      expires_at: new Date(Date.now() + 3_600_000),
      created_at: new Date(Date.now() - 1000),
    })
    .execute();
}
