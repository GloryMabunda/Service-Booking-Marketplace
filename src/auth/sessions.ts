import { createHash, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB, UserRole } from '../database/database.types.js';

// Server-side admin sessions (#27). The browser keeps a random 256-bit key in
// an HttpOnly cookie; the database keeps only its SHA-256 hash.

export const SESSION_COOKIE = 'mbg_session';
// A session ends after 12 hours without a request, and after 7 days at most.
export const SESSION_IDLE_MS = 12 * 60 * 60_000;
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

// Starts a session and returns the key to put in the cookie. Expired sessions
// are tidied away at the same time.
export async function createSession(
  db: Kysely<DB>,
  userId: string,
  now = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.deleteFrom('sessions').where('expires_at', '<=', now).execute();
  await db
    .insertInto('sessions')
    .values({
      token_hash: hashSessionToken(token),
      user_id: userId,
      created_at: now,
      last_used_at: now,
      expires_at: new Date(now.getTime() + SESSION_MAX_AGE_MS),
    })
    .execute();
  return token;
}

// The signed-in user for a cookie value, or null if the session is unknown,
// idle too long or past its maximum age. A valid session's idle timer restarts.
export async function findSession(
  db: Kysely<DB>,
  token: string,
  now = new Date(),
): Promise<SessionUser | null> {
  const tokenHash = hashSessionToken(token);
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'users.id',
      'users.email',
      'users.role',
      'sessions.last_used_at',
      'sessions.expires_at',
    ])
    .where('sessions.token_hash', '=', tokenHash)
    .executeTakeFirst();
  if (!row) return null;

  const idleUntil = new Date(row.last_used_at).getTime() + SESSION_IDLE_MS;
  if (now.getTime() >= idleUntil || now >= new Date(row.expires_at)) {
    await db
      .deleteFrom('sessions')
      .where('token_hash', '=', tokenHash)
      .execute();
    return null;
  }

  await db
    .updateTable('sessions')
    .set({ last_used_at: now })
    .where('token_hash', '=', tokenHash)
    .execute();
  return { id: row.id, email: row.email, role: row.role };
}

export async function deleteSession(
  db: Kysely<DB>,
  token: string,
): Promise<void> {
  await db
    .deleteFrom('sessions')
    .where('token_hash', '=', hashSessionToken(token))
    .execute();
}

// Signs the user out everywhere, e.g. after a password reset.
export async function deleteUserSessions(
  db: Kysely<DB>,
  userId: string,
): Promise<void> {
  await db.deleteFrom('sessions').where('user_id', '=', userId).execute();
}
