// On a server: node dist/scripts/migrate.js (#90). Applies the migrations that
// haven't run yet, then exits 0. If one fails it exits 1 and the deploy stops
// before the new version starts. Reads DATABASE_URL from the environment.
import { join } from 'node:path';
import { validateEnv } from '../config/env.js';
import { createDatabase } from '../database/database.js';
import { runMigrations } from '../database/migrate.js';

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const db = createDatabase(env.DATABASE_URL);
  try {
    const applied = await runMigrations(
      db,
      join(import.meta.dirname, '..', 'database', 'migrations'),
    );
    console.log(
      applied.length
        ? `Applied ${applied.length} migration(s): ${applied.join(', ')}`
        : 'The database is up to date',
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
