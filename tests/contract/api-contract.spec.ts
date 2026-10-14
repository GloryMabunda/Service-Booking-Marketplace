import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type request from 'supertest';
import { addDays } from '../../src/availability/time-zone.js';
import { startHarness, type Harness } from '../helpers/harness.js';
import { upcoming } from '../helpers/dates.js';
import { listRoutes, shape } from '../helpers/routes.js';

// The API behaves as docs/api.md says (#82). Instead of repeating the document
// in code, the tests read it: the endpoint index must match the routes the app
// really has (both ways), every error code in the source must be in the error
// table, every error has the documented shape, and what an endpoint returns
// has the same fields as the JSON example the document gives for it.

const doc = readFileSync('docs/api.md', 'utf8');
const PDF = Buffer.from('%PDF-1.4\n%proof\n');

// --- Reading the document ------------------------------------------------------

// The text of a section: from its heading to the next heading of the same or
// a higher level
function section(heading: string): string {
  const start = doc.indexOf(heading);
  if (start < 0)
    throw new Error(`The API document has no section "${heading}"`);
  const level = heading.match(/^#+/)?.[0].length ?? 3;
  const rest = doc.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

// The first JSON example after a marker such as "**Response `200`**"
function exampleAfter(text: string, marker: RegExp): unknown {
  const at = text.search(marker);
  if (at < 0) throw new Error(`No marker ${String(marker)}`);
  const block = /```json\n([\s\S]*?)```/.exec(text.slice(at));
  if (!block) throw new Error(`No JSON example after ${String(marker)}`);
  return JSON.parse(block[1]) as unknown;
}

// Do the two have the same fields? The example's "..." entries and empty lists
// stand for "see elsewhere", and a null on either side means "optional".
function sameFields(example: unknown, actual: unknown, path = '$'): string[] {
  if (example === null || actual === null || actual === undefined) return [];
  if (Array.isArray(example)) {
    if (!Array.isArray(actual)) return [`${path}: expected a list`];
    if (example.length === 0 || actual.length === 0) return [];
    return sameFields(example[0], actual[0], `${path}[0]`);
  }
  if (typeof example === 'object') {
    if (typeof actual !== 'object' || Array.isArray(actual)) {
      return [`${path}: expected an object`];
    }
    const wanted = Object.keys(example);
    if (wanted.includes('...')) return [];
    const have = Object.keys(actual);
    const problems: string[] = [];
    for (const key of wanted) {
      if (!have.includes(key))
        problems.push(`${path}.${key}: documented but not returned`);
    }
    for (const key of have) {
      if (!wanted.includes(key))
        problems.push(`${path}.${key}: returned but not documented`);
    }
    for (const key of wanted.filter((k) => have.includes(k))) {
      problems.push(
        ...sameFields(
          (example as Record<string, unknown>)[key],
          (actual as Record<string, unknown>)[key],
          `${path}.${key}`,
        ),
      );
    }
    return problems;
  }
  return typeof example === typeof actual
    ? []
    : [
        `${path}: documented as ${typeof example}, returned as ${typeof actual}`,
      ];
}

// The conventions of section 1: money is a string with two decimals, and a
// time is ISO 8601 in UTC without milliseconds
const MONEY =
  /^(price|depositAmount|amountReceived|refundAmount|priceAtBooking)$/;
const TIME = /(At|Until|start|end)$/;
function conventionProblems(value: unknown, path = '$'): string[] {
  if (Array.isArray(value))
    return value.flatMap((v, i) => conventionProblems(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) => {
      const here = `${path}.${key}`;
      if (typeof v === 'string' && MONEY.test(key) && !/^\d+\.\d{2}$/.test(v)) {
        return [
          `${here}: money should look like "650.00", got ${JSON.stringify(v)}`,
        ];
      }
      if (typeof v === 'number' && MONEY.test(key))
        return [`${here}: money must be a string`];
      if (
        typeof v === 'string' &&
        TIME.test(key) &&
        /^\d{4}-\d\d-\d\d[T ]/.test(v) &&
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)
      ) {
        return [
          `${here}: time should be 2026-11-03T07:00:00Z, got ${JSON.stringify(v)}`,
        ];
      }
      return conventionProblems(v, here);
    });
  }
  return [];
}

describe('API contract (docs/api.md)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness('contract');
  });
  beforeEach(() => h.reset());
  afterEach(async () => {
    // An email sent in the background (a new booking link) may still be writing
    // its notification record
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

  // --- The endpoint index matches the routes -----------------------------------

  describe('the endpoint index', () => {
    // Only the index table itself: other tables list some of the same endpoints
    const index = section('### Endpoint index');
    const documented = [
      ...index.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE) (\/[^`]+)` \|/gm),
    ].map((m) => `${m[1]} ${m[2].replace(/:\w+/g, ':param')}`);
    // Pages the site serves, which are not API endpoints
    const PAGES = ['GET /booking/:param'];

    it('lists every endpoint once', () => {
      expect(documented.length).toBeGreaterThan(40);
      expect(new Set(documented).size).toBe(documented.length);
    });

    it('documents every route the app has', () => {
      const routes = listRoutes(h.app)
        .map(shape)
        .filter((r) => !PAGES.includes(r));
      const missing = routes.filter((r) => !documented.includes(r));
      expect(missing, 'routes missing from the endpoint index').toEqual([]);
    });

    it('has a route for everything the document lists', () => {
      const routes = listRoutes(h.app).map(shape);
      const ghosts = documented.filter((d) => !routes.includes(d));
      expect(ghosts, 'documented endpoints that do not exist').toEqual([]);
    });

    it('has a section for every endpoint the index links to', () => {
      const links = [
        ...index.matchAll(
          /^\| `[A-Z]+ [^`]+` \| [^|]+ \| \[([\d.]+)\]\(#[^)]+\) \|/gm,
        ),
      ].map((m) => m[1]);
      expect(links.length).toBe(documented.length);
      for (const number of new Set(links)) {
        expect(doc, `section ${number}`).toMatch(
          new RegExp(`^#{3} ${number.replace('.', '\\.')} `, 'm'),
        );
      }
    });
  });

  // --- Error codes ---------------------------------------------------------------

  describe('error codes', () => {
    const table = section('### Error codes');
    const documentedCodes = new Set(
      [...table.matchAll(/^\| \d{3} \| `([A-Z_]+)` \|/gm)].map((m) => m[1]),
    );

    // Every .ts file under src, except tests
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
      });
    const used = new Set<string>();
    for (const file of files('src')) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(
        /(?:ApiException\(|super\()\s*\d{3},\s*'([A-Z][A-Z0-9_]+)'/g,
      ))
        used.add(m[1]);
      for (const m of text.matchAll(/^\s+\d{3}: \['([A-Z][A-Z0-9_]+)'/gm))
        used.add(m[1]);
      // An error answer written out by hand: { code: 'INTERNAL_ERROR', ... }
      for (const m of text.matchAll(/\bcode: '([A-Z][A-Z0-9_]+)'/g))
        used.add(m[1]);
    }

    it('finds the codes in the source and in the document', () => {
      expect(documentedCodes.size).toBeGreaterThan(20);
      expect(used.size).toBeGreaterThan(20);
    });

    it('documents every error code the code can send', () => {
      const undocumented = [...used]
        .filter((c) => !documentedCodes.has(c))
        .sort();
      expect(
        undocumented,
        'codes used in src but missing from the error table',
      ).toEqual([]);
    });

    it('does not document a code nothing sends', () => {
      const unused = [...documentedCodes].filter((c) => !used.has(c)).sort();
      expect(unused, 'codes in the error table that no code sends').toEqual([]);
    });
  });

  // --- Every error has the documented shape ----------------------------------------

  describe('error responses', () => {
    const problems = (res: request.Response) => {
      const keys = Object.keys(res.body as object).sort();
      const out: string[] = [];
      if (keys.join() !== 'code,details,message,statusCode')
        out.push(`keys were ${keys.join()}`);
      if (res.body.statusCode !== res.status)
        out.push('statusCode differs from the HTTP status');
      if (!/^[A-Z][A-Z0-9_]+$/.test(res.body.code))
        out.push('code is not UPPER_SNAKE_CASE');
      if (typeof res.body.message !== 'string' || res.body.message.length < 5)
        out.push('no message');
      if (res.body.details !== null && !Array.isArray(res.body.details))
        out.push('details is not null or a list');
      const text = JSON.stringify(res.body);
      if (
        /\bat .+\(.+:\d+:\d+\)|node_modules|SELECT |INSERT |pg_|stack/i.test(
          text,
        )
      ) {
        out.push('looks like it leaks internals');
      }
      return out;
    };

    const cases: [string, () => request.Test][] = [
      ['an unknown API route', () => h.http().get('/api/does-not-exist')],
      [
        'an unknown route under admin',
        () => h.http().get('/api/admin/nothing-here'),
      ],
      ['a wrong method', () => h.http().delete('/api/services')],
      ['no session', () => h.http().get('/api/admin/bookings')],
      [
        'a made-up session',
        () =>
          h.http().get('/api/admin/settings').set('Cookie', 'mbg_session=x'),
      ],
      [
        'wrong login',
        () =>
          h
            .http()
            .post('/api/auth/login')
            .send({ email: 'a@example.com', password: 'wrong-password-123' }),
      ],
      [
        'a login with nothing in it',
        () => h.http().post('/api/auth/login').send({}),
      ],
      [
        'a booking with nothing in it',
        () => h.http().post('/api/bookings').send({}),
      ],
      [
        'a booking with bad details',
        () =>
          h.http().post('/api/bookings').send({
            serviceId: 'nope',
            startAt: 'now',
            clientName: '',
            clientEmail: 'x',
            clientPhone: '1',
          }),
      ],
      [
        'broken JSON',
        () =>
          h
            .http()
            .post('/api/bookings')
            .set('Content-Type', 'application/json')
            .send('{"broken": '),
      ],
      [
        'an oversized JSON body',
        () =>
          h
            .http()
            .post('/api/bookings')
            .send({ notes: 'x'.repeat(20_000) }),
      ],
      [
        'a lookup that finds nothing',
        () =>
          h
            .http()
            .post('/api/bookings/BK-999999/lookup')
            .send({ email: 'a@example.com' }),
      ],
      [
        'a bad booking link',
        () => h.http().get(`/api/booking/${'x'.repeat(43)}`),
      ],
      [
        'a missing availability service',
        () => h.http().get('/api/availability?date=2026-11-03'),
      ],
      [
        'a media key that does not exist',
        () => h.http().get(`/media/${'a'.repeat(64)}.webp`),
      ],
      [
        'an admin id that does not exist',
        () =>
          h.asAdmin(
            h
              .http()
              .get('/api/admin/bookings/00000000-0000-0000-0000-000000000000'),
          ),
      ],
      [
        'bad admin input',
        () =>
          h.asAdmin(h.http().post('/api/admin/services').send({ name: '' })),
      ],
      [
        'bad admin list filters',
        () =>
          h.asAdmin(h.http().get('/api/admin/bookings?status=nonsense&page=0')),
      ],
      [
        'a change from another site',
        () =>
          h.asAdmin(
            h
              .http()
              .post('/api/admin/services')
              .set('Sec-Fetch-Site', 'cross-site')
              .send({}),
          ),
      ],
      [
        'a status change that is not allowed',
        async () => {
          const { booking } = await h.makeBooking({ status: 'cancelled' });
          return h.asAdmin(
            h
              .http()
              .post(`/api/admin/bookings/${booking.id}/confirm-payment`)
              .send({ amountReceived: '325.00' }),
          );
        },
      ] as unknown as [string, () => request.Test],
    ];

    it.each(cases)('has the documented shape for %s', async (_name, send) => {
      const res = await send();
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(problems(res)).toEqual([]);
    });

    it('sends a 429 with Retry-After and the RateLimit headers', async () => {
      let res: request.Response | null = null;
      for (let i = 0; i < 11; i++) {
        res = await h
          .http()
          .post('/api/bookings/BK-000001/lookup')
          .send({ email: 'a@example.com' });
      }
      expect(res?.status).toBe(429);
      expect(problems(res as request.Response)).toEqual([]);
      expect(Number(res?.headers['retry-after'])).toBeGreaterThan(0);
      expect(res?.headers['ratelimit-limit']).toBe('10');
      expect(res?.headers['ratelimit-remaining']).toBe('0');
      expect(Number(res?.headers['ratelimit-reset'])).toBeGreaterThan(0);
    });

    it('sends the RateLimit headers on a rate-limited answer that worked', async () => {
      const res = await h.http().get('/api/services');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('120');
      expect(Number(res.headers['ratelimit-remaining'])).toBeLessThan(120);
      expect(res.headers['ratelimit-reset']).toBeDefined();
    });
  });

  // --- What an endpoint returns has the documented fields ----------------------------

  describe('responses', () => {
    interface Case {
      name: string;
      heading: string;
      marker: RegExp;
      status: number;
      call: () => Promise<request.Response>;
    }
    const R200 = /\*\*Response `200`\*\*/;

    // A pending booking with a proof, its link token, and a confirmed booking
    let pending: Awaited<ReturnType<Harness['makeBooking']>>;
    let confirmed: Awaited<ReturnType<Harness['makeBooking']>>;
    let proofId: string;
    let slotDate: string;

    beforeEach(async () => {
      slotDate = upcoming(3); // a Wednesday inside the booking window
      pending = await h.makeBooking();
      confirmed = await h.makeBooking({ status: 'confirmed' });
      await h
        .http()
        .post(`/api/booking/${pending.token}/proofs`)
        .attach('file', PDF, { filename: 'p.pdf' });
      const proof = await h.db
        .selectFrom('payment_proofs')
        .select('id')
        .where('booking_id', '=', pending.booking.id)
        .executeTakeFirstOrThrow();
      proofId = proof.id;
      h.provider.sent = [];
      await h.reset();
    });

    const cases = (): Case[] => [
      {
        name: 'services',
        heading: '### 4.1 `GET /api/services`',
        marker: R200,
        status: 200,
        call: () => h.http().get('/api/services'),
      },
      {
        name: 'availability',
        heading: '### 4.2 `GET /api/availability`',
        marker: R200,
        status: 200,
        call: () =>
          h
            .http()
            .get(
              `/api/availability?serviceId=${h.service.id}&date=${slotDate}`,
            ),
      },
      {
        name: 'create a booking',
        heading: '### 4.3 `POST /api/bookings`',
        marker: /\*\*Response `201`\*\*/,
        status: 201,
        call: () => {
          const start = new Date(`${slotDate}T07:00:00Z`);
          return h
            .http()
            .post('/api/bookings')
            .send({
              serviceId: h.service.id,
              startAt: start.toISOString().replace('.000Z', 'Z'),
              clientName: 'Contract Tester',
              clientEmail: 'contract.tester@example.com',
              clientPhone: '082 555 7777',
            });
        },
      },
      {
        name: 'booking lookup',
        heading: '### 4.4 `POST /api/bookings/:reference/lookup`',
        marker: R200,
        status: 200,
        call: () =>
          h
            .http()
            .post(`/api/bookings/${pending.booking.reference}/lookup`)
            .send({ email: pending.booking.client_email }),
      },
      {
        name: 'resend a booking link',
        heading: '### 4.5 `POST /api/bookings/:reference/resend-booking-link`',
        marker: /\*\*Response `202`\*\*/,
        status: 202,
        call: () =>
          h
            .http()
            .post(
              `/api/bookings/${pending.booking.reference}/resend-booking-link`,
            )
            .send({ email: pending.booking.client_email }),
      },
      {
        name: 'the site',
        heading: '### 4.6 `GET /api/site`',
        marker: R200,
        status: 200,
        call: () => h.http().get('/api/site'),
      },
      {
        name: 'the booking page data',
        heading: '### 5.1 `GET /api/booking/:token`',
        marker: R200,
        status: 200,
        call: () => h.http().get(`/api/booking/${pending.token}`),
      },
      {
        name: 'upload a proof',
        heading: '### 5.2 `POST /api/booking/:token/proofs`',
        marker: /\*\*Response `201`\*\*/,
        status: 201,
        call: () =>
          h
            .http()
            .post(`/api/booking/${pending.token}/proofs`)
            .attach('file', Buffer.concat([PDF, Buffer.from('2')]), {
              filename: 'p.pdf',
            }),
      },
      {
        name: 'cancel through the link',
        heading: '### 5.3 `POST /api/booking/:token/cancel`',
        marker: R200,
        status: 200,
        call: () => h.http().post(`/api/booking/${confirmed.token}/cancel`),
      },
      {
        name: 'the dashboard',
        heading: '### 7.1 `GET /api/admin/dashboard`',
        marker: R200,
        status: 200,
        call: () => h.asAdmin(h.http().get('/api/admin/dashboard')),
      },
      {
        name: 'the bookings list',
        heading: '### 7.2 `GET /api/admin/bookings`',
        marker: R200,
        status: 200,
        call: () =>
          h.asAdmin(
            h.http().get(`/api/admin/bookings?q=${pending.booking.reference}`),
          ),
      },
      {
        name: 'one booking',
        heading: '### 7.3 `GET /api/admin/bookings/:id`',
        marker: R200,
        status: 200,
        call: () =>
          h.asAdmin(h.http().get(`/api/admin/bookings/${pending.booking.id}`)),
      },
      {
        name: 'the calendar',
        heading: '### 7.11 `GET /api/admin/calendar`',
        marker: R200,
        status: 200,
        call: () =>
          h.asAdmin(
            h
              .http()
              .get(
                `/api/admin/calendar?from=${upcoming(2)}&to=${addDays(upcoming(2), 60)}`,
              ),
          ),
      },
    ];

    it.each([...Array(13).keys()])(
      'case %i returns what the document shows, in the documented style',
      async (index) => {
        const c = cases()[index];
        const res = await c.call();
        expect(res.status, c.name).toBe(c.status);
        const example = exampleAfter(section(c.heading), c.marker);
        expect(sameFields(example, res.body), c.name).toEqual([]);
        expect(conventionProblems(res.body), c.name).toEqual([]);
      },
    );

    it('returns the admin settings as documented', async () => {
      const res = await h.asAdmin(h.http().get('/api/admin/settings'));
      const example = exampleAfter(
        section('### 7.15 Settings'),
        /\*\*`GET \/api\/admin\/settings`\*\*/,
      );
      expect(sameFields(example, res.body)).toEqual([]);
      expect(conventionProblems(res.body)).toEqual([]);
    });

    it('returns the site content as documented', async () => {
      const res = await h.asAdmin(h.http().get('/api/admin/site-content'));
      const example = exampleAfter(
        section('### 7.16 Site content'),
        /\*\*`GET \/api\/admin\/site-content`\*\*/,
      );
      expect(sameFields(example, res.body)).toEqual([]);
    });

    it('returns the confirm-payment answer as documented', async () => {
      const res = await h.asAdmin(
        h
          .http()
          .post(`/api/admin/bookings/${pending.booking.id}/confirm-payment`)
          .send({ amountReceived: '325.00' }),
      );
      expect(res.status).toBe(200);
      // The document gives this shape in words, not as an example: the
      // booking and the address the confirmation went to
      expect(
        section('### 7.4 `POST /api/admin/bookings/:id/confirm-payment`'),
      ).toContain('"emailSentTo"');
      expect(Object.keys(res.body).sort()).toEqual(['booking', 'emailSentTo']);
      expect(conventionProblems(res.body)).toEqual([]);
    });

    it('returns a reviewed proof as documented', async () => {
      const res = await h.asAdmin(
        h
          .http()
          .patch(`/api/admin/payment-proofs/${proofId}`)
          .send({ status: 'accepted' }),
      );
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['proof']);
      const detail = await h.asAdmin(
        h.http().get(`/api/admin/bookings/${pending.booking.id}`),
      );
      expect(sameFields(detail.body.proofs[0], res.body.proof)).toEqual([]);
    });

    it('returns a new booking link answer as documented', async () => {
      const res = await h.asAdmin(
        h.http().post(`/api/admin/bookings/${pending.booking.id}/booking-link`),
      );
      expect(res.status).toBe(202);
      const example = exampleAfter(
        section('### 7.8 `POST /api/admin/bookings/:id/booking-link`'),
        /\*\*Response `202`\*\*/,
      );
      expect(sameFields(example, res.body)).toEqual([]);
    });
  });
});
