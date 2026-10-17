// node dist/scripts/reset-demo.js (docs/demo.md): empties the database of a
// hosted demo, so it starts fresh and matches its (wiped) uploads folder. Does
// nothing unless DEMO_MODE and DEMO_RESET_ON_START are both true.
import { validateEnv } from '../config/env.js';
import { createDatabase } from '../database/database.js';
import {
  resetDemoDatabase,
  shouldResetDemo,
} from '../demo/reset-demo-database.js';

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  if (!shouldResetDemo(process.env)) {
    console.log('Reset skipped (needs DEMO_MODE and DEMO_RESET_ON_START)');
    return;
  }
  const db = createDatabase(env.DATABASE_URL);
  try {
    await resetDemoDatabase(db);
    console.log('The demo database was emptied');
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
