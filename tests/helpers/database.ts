import { type Kysely, sql } from 'kysely';
import { createDatabase } from '../../src/database/database.js';
import type { DB } from '../../src/database/database.types.js';

// Opens the test database from TEST_DATABASE_URL (.env, or the real
// environment in CI). Call destroy() on the result in afterAll.
export function createTestDatabase(): Kysely<DB> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Add it to .env (see .env.example).',
    );
  }
  return createDatabase(connectionString);
}

// Runs work inside a transaction that is always rolled back, so a test can
// insert anything without leaving data behind for the next one.
export async function inRolledBackTransaction(
  db: Kysely<DB>,
  work: (trx: Kysely<DB>) => Promise<void>,
): Promise<void> {
  await db.connection().execute(async (conn) => {
    await sql`BEGIN`.execute(conn);
    try {
      await work(conn);
    } finally {
      await sql`ROLLBACK`.execute(conn);
    }
  });
}
