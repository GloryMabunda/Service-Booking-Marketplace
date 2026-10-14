import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { seedAdmin } from '../../src/auth/seed-admin.js';
import type { DB } from '../../src/database/database.types.js';

export interface TestAdmin {
  id: string;
  email: string;
  // "mbg_session=…", ready for .set('Cookie', admin.cookie)
  cookie: string;
}

// Creates an admin in the test database and signs in through the real login
// endpoint (#27). Pair it with removeTestAdmin in afterAll. Only one admin
// exists at a time, so test files using this must not overlap (they don't:
// integration test files run one after another).
export async function signInTestAdmin(
  app: INestApplication<App>,
  db: Kysely<DB>,
  email: string,
): Promise<TestAdmin> {
  const password = 'test-admin-password';
  const { id } = await db
    .transaction()
    .execute((trx) => seedAdmin(trx, { email, password }));
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('mbg_session='));
  if (!cookie) throw new Error('login did not set a session cookie');
  return { id, email, cookie: cookie.split(';')[0] };
}

export async function removeTestAdmin(
  db: Kysely<DB>,
  admin: TestAdmin,
): Promise<void> {
  // Changing a setting or the home page records who did it; forget that
  // before deleting the admin, or the foreign key refuses the delete.
  await db
    .updateTable('settings')
    .set({ updated_by: null })
    .where('updated_by', '=', admin.id)
    .execute();
  await db
    .updateTable('site_content')
    .set({ updated_by: null })
    .where('updated_by', '=', admin.id)
    .execute();
  await db.deleteFrom('users').where('id', '=', admin.id).execute();
}
