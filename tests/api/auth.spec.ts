import {
  Controller,
  Get,
  type INestApplication,
  Module,
  Post,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from '../../src/app.factory.js';
import { AppModule } from '../../src/app.module.js';
import { CurrentUser, Roles } from '../../src/auth/auth.guard.js';
import { seedAdmin } from '../../src/auth/seed-admin.js';
import type { SessionUser } from '../../src/auth/sessions.js';
import type { DB, UserRole } from '../../src/database/database.types.js';
import { createTestDatabase } from '../helpers/database.js';

// Admin login, sessions and the guard on /api/admin (#27, docs/api.md
// section 6). Test-only admin routes check that the guard covers any route
// under /api/admin, not just the ones that exist today.

@Controller('admin/test-only')
class TestAdminController {
  @Get()
  read(@CurrentUser() user: SessionUser) {
    return { email: user.email };
  }

  @Post()
  change() {
    return { changed: true };
  }
}

@Controller('admin/test-other-role')
@Roles('owner' as UserRole) // a role the admin doesn't have
class TestOtherRoleController {
  @Get()
  read() {
    return { ok: true };
  }
}

@Module({
  imports: [AppModule],
  controllers: [TestAdminController, TestOtherRoleController],
})
class TestRootModule {}

// The error shape from docs/api.md section 2.
interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details: { field: string; message: string }[] | null;
}
const errorBody = (res: request.Response) => res.body as ErrorBody;

const ADMIN = {
  email: 'auth-test@example.com',
  password: 'auth-test-password',
};

async function startApp(): Promise<INestApplication<App>> {
  const app = await createApp<INestApplication<App>>(
    { logger: false },
    TestRootModule,
  );
  await app.init();
  return app;
}

function sessionCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('mbg_session='));
  if (!cookie) throw new Error('no session cookie set');
  return cookie;
}

describe('Admin authentication', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;

  beforeAll(async () => {
    db = createTestDatabase();
    await db.transaction().execute((trx) => seedAdmin(trx, ADMIN));
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
    await db.deleteFrom('users').where('email', '=', ADMIN.email).execute();
    await db.destroy();
  });

  const login = (body: object) =>
    request(app.getHttpServer()).post('/api/auth/login').send(body);

  describe('the guard on /api/admin', () => {
    it('returns 401 UNAUTHENTICATED without a session', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/test-only')
        .expect(401);
      expect(res.body).toEqual({
        statusCode: 401,
        code: 'UNAUTHENTICATED',
        message: 'Please sign in.',
        details: null,
      });
    });

    it('returns 401 for a made-up session cookie', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/test-only')
        .set('Cookie', 'mbg_session=not-a-real-session')
        .expect(401);
    });

    it('protects changes as well as reads', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/test-only')
        .expect(401);
    });
  });

  describe('POST /api/auth/login', () => {
    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const wrongPassword = await login({
        email: ADMIN.email,
        password: 'not-the-password',
      }).expect(401);
      const unknownEmail = await login({
        email: 'nobody@example.com',
        password: 'not-the-password',
      }).expect(401);
      expect(wrongPassword.body).toEqual({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'The email or password is incorrect.',
        details: null,
      });
      expect(unknownEmail.body).toEqual(wrongPassword.body);
      expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    });

    it('lists each problem with the request', async () => {
      const res = await login({ email: 'not-an-email' }).expect(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
      expect(errorBody(res).details).toEqual([
        { field: 'email', message: 'Enter a valid email address.' },
        { field: 'password', message: 'Enter your password.' },
      ]);
    });

    it('rejects unknown fields', async () => {
      const res = await login({ ...ADMIN, remember: true }).expect(400);
      expect(errorBody(res).details).toEqual([
        { field: '(body)', message: 'Unknown field: remember.' },
      ]);
    });

    it('signs in with an HttpOnly, SameSite=Strict cookie and no token in the body', async () => {
      const res = await login({
        email: ' AUTH-TEST@example.com ',
        password: ADMIN.password,
      }).expect(200);
      expect(res.body).toEqual({
        user: { email: ADMIN.email, role: 'admin' },
      });
      expect(res.headers['cache-control']).toBe('no-store');

      const cookie = sessionCookie(res);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/Max-Age=604800/); // 7 days
      expect(JSON.stringify(res.body)).not.toContain(
        cookie.split(';')[0].split('=')[1],
      );
    });
  });

  describe('with a session', () => {
    let cookie: string;

    beforeEach(async () => {
      cookie = sessionCookie(await login(ADMIN).expect(200)).split(';')[0];
    });

    it('lets the admin into /api/admin routes', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/test-only')
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body).toEqual({ email: ADMIN.email });
    });

    it('reports who is signed in', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body).toEqual({ user: { email: ADMIN.email, role: 'admin' } });
    });

    it('returns 403 FORBIDDEN when the role is not allowed', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/test-other-role')
        .set('Cookie', cookie)
        .expect(403);
      expect(errorBody(res).code).toBe('FORBIDDEN');
    });

    it('blocks changes sent from another website (CSRF)', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/test-only')
        .set('Cookie', cookie)
        .set('Origin', 'https://evil.example')
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/admin/test-only')
        .set('Cookie', cookie)
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);
    });

    it('allows changes from the site itself', async () => {
      const server = app.getHttpServer();
      const res = await request(server)
        .post('/api/admin/test-only')
        .set('Cookie', cookie)
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(201);
      expect(res.body).toEqual({ changed: true });
    });

    it('logs out: the cookie is cleared and the session stops working', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .expect(204);
      expect(sessionCookie(res)).toMatch(/mbg_session=;/);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(401);
    });
  });
});

describe('Login rate limit', () => {
  let db: Kysely<DB>;
  let app: INestApplication<App>;
  const email = 'rate-limit-test@example.com';
  const password = 'rate-limit-password';

  beforeAll(async () => {
    db = createTestDatabase();
    await db
      .transaction()
      .execute((trx) => seedAdmin(trx, { email, password }));
    app = await startApp(); // a fresh app, so other tests' attempts don't count
  });

  afterAll(async () => {
    await app.close();
    await db.deleteFrom('users').where('email', '=', email).execute();
    await db.destroy();
  });

  it('blocks a 6th failed attempt within 15 minutes, even with the right password', async () => {
    const login = (pw: string) =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: pw });

    for (let i = 0; i < 5; i++) await login('wrong-password').expect(401);

    const blocked = await login(password).expect(429);
    expect(errorBody(blocked).code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(800);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(900);
    expect(blocked.headers['ratelimit-limit']).toBe('5');
    expect(blocked.headers['ratelimit-remaining']).toBe('0');
  });
});
