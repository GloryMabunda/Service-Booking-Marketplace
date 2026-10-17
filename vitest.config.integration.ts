import { defineConfig } from 'vitest/config';
import { envFileValues } from './tests/setup/env-file.js';

// Variables from .env, unless already set in the real environment (#20).
const fileEnv = envFileValues();
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL;

// Integration, API and concurrency tests (npm run test:integration): the real
// database and the whole app. Needs Docker running (npm run db:up).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['tests/**/*.spec.ts'],
    env: {
      ...fileEnv,
      // The app under test uses the test database too, so tests never read or
      // change development data (#27).
      ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {}),
      // Whatever the developer runs locally (demo mode, a real mail server) must
      // never change a test result or send a real email from a test run.
      DEMO_MODE: '',
      SMTP_HOST: '',
    },
    // Migrates the test database before the tests run (#19).
    globalSetup: ['./tests/setup/migrate-test-database.ts'],
    // Test files share one database, so they run one after another.
    fileParallelism: false,
  },
});
