import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { DB } from '../database/database.types.js';
import { hashPassword } from './password.js';

// The single administrator account is created from ADMIN_EMAIL and
// ADMIN_PASSWORD by `npm run seed:admin` (#26). There is no sign-up and no
// password-reset screen: running the script again resets the password
// (specification section 3).

const adminSeedSchema = z.object({
  ADMIN_EMAIL: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('must be a valid email address')),
  ADMIN_PASSWORD: z
    .string()
    .min(12, 'must be at least 12 characters')
    .max(256, 'must be at most 256 characters'),
});

export interface AdminSeedInput {
  email: string;
  password: string;
}

// Reads the two variables, or throws one error naming every problem. The
// password is never included in the message.
export function parseAdminSeedEnv(
  raw: Record<string, unknown>,
): AdminSeedInput {
  const result = adminSeedSchema.safeParse(raw);
  if (result.success) {
    return {
      email: result.data.ADMIN_EMAIL,
      password: result.data.ADMIN_PASSWORD,
    };
  }
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.');
    const missing = raw[name] === undefined || raw[name] === '';
    return `  - ${name}: ${missing ? 'is required but not set' : issue.message}`;
  });
  throw new Error(
    `Cannot seed the administrator:\n${problems.join('\n')}\n` +
      'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env (see .env.example).',
  );
}

export interface SeedAdminResult {
  // created: no admin existed. password-reset: same email, new password.
  // email-changed: the existing admin moved to the new email (one admin only).
  action: 'created' | 'password-reset' | 'email-changed';
  id: string;
}

// Creates or updates the one administrator. Call it inside a transaction so
// the lookup and the write can't interleave with another run.
export async function seedAdmin(
  db: Kysely<DB>,
  input: AdminSeedInput,
): Promise<SeedAdminResult> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  const sameEmail = await db
    .selectFrom('users')
    .select('id')
    .where(({ fn, eb }) => eb(fn('lower', ['email']), '=', email))
    .forUpdate()
    .executeTakeFirst();
  if (sameEmail) {
    await db
      .updateTable('users')
      .set({ password_hash: passwordHash, role: 'admin' })
      .where('id', '=', sameEmail.id)
      .execute();
    return { action: 'password-reset', id: sameEmail.id };
  }

  // A different email: keep the existing admin row (bookings reference it in
  // payment_verified_by) and move it to the new email.
  const existingAdmin = await db
    .selectFrom('users')
    .select('id')
    .where('role', '=', 'admin')
    .orderBy('created_at')
    .forUpdate()
    .executeTakeFirst();
  if (existingAdmin) {
    await db
      .updateTable('users')
      .set({ email, password_hash: passwordHash })
      .where('id', '=', existingAdmin.id)
      .execute();
    return { action: 'email-changed', id: existingAdmin.id };
  }

  const created = await db
    .insertInto('users')
    .values({ email, password_hash: passwordHash, role: 'admin' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { action: 'created', id: created.id };
}
