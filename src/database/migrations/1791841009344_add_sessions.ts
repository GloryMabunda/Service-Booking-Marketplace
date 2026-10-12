import { type Kysely, sql } from 'kysely';

// Admin sessions (#27). The browser holds a random session key in an HttpOnly
// cookie; only its SHA-256 hash is stored, so a leaked database can't be used
// to sign in. A session ends when it is idle too long (last_used_at), when it
// reaches expires_at, on logout, or when the admin's password is reset.
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      String.raw`
CREATE TABLE sessions (
  token_hash   bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  CONSTRAINT sessions_expiry CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw('DROP TABLE sessions;').execute(db);
}
