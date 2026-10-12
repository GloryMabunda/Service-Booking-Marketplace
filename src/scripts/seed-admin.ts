// npm run seed:admin — creates the administrator, or resets the password
// (#26). Reads ADMIN_EMAIL and ADMIN_PASSWORD, and DATABASE_URL, from .env
// or the real environment. On a server, run the compiled file instead:
//   node dist/scripts/seed-admin.js
import { existsSync } from 'node:fs';
import { parseAdminSeedEnv, seedAdmin } from '../auth/seed-admin.js';
import { validateEnv } from '../config/env.js';
import { createDatabase } from '../database/database.js';

const MESSAGES = {
  created: 'Created the administrator account',
  'password-reset': 'Reset the administrator password',
  'email-changed': 'Moved the administrator account to a new email',
} as const;

async function main(): Promise<void> {
  // Real environment variables win; loadEnvFile never overwrites them.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = validateEnv(process.env);
  const input = parseAdminSeedEnv(process.env);

  const db = createDatabase(env.DATABASE_URL);
  try {
    const result = await db
      .transaction()
      .execute((trx) => seedAdmin(trx, input));
    console.log(`${MESSAGES[result.action]}: ${input.email}`);
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
