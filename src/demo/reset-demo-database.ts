import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../database/database.types.js';

// A hosted demo starts fresh every time it wakes up (docs/demo.md): its
// pictures live on a disk that free hosts wipe, so the data is wiped to match
// and made again. This empties the whole database, so it only runs in demo
// mode and only when asked for with DEMO_RESET_ON_START.
export function shouldResetDemo(env: Record<string, string | undefined>) {
  const on = (value: string | undefined) => /^(true|1)$/i.test(value ?? '');
  return on(env.DEMO_MODE) && on(env.DEMO_RESET_ON_START);
}

export async function resetDemoDatabase(db: Kysely<DB>): Promise<void> {
  await sql`DROP SCHEMA public CASCADE`.execute(db);
  await sql`CREATE SCHEMA public`.execute(db);
}
