import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './database.types.js';

// Opens a Kysely connection pool to PostgreSQL, typed with the generated
// schema. Call destroy() on the result when finished.
export function createDatabase(connectionString: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  });
}
