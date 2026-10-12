import { defineConfig } from 'vitest/config';
import { envFileValues } from './tests/setup/env-file.js';

// Integration, API and concurrency tests (npm run test:integration): the real
// database and the whole app. Needs Docker running (npm run db:up).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['tests/**/*.spec.ts'],
    // Variables from .env, unless already set in the real environment (#20).
    env: envFileValues(),
    // Migrates the test database before the tests run (#19).
    globalSetup: ['./tests/setup/migrate-test-database.ts'],
    // Test files share one database, so they run one after another.
    fileParallelism: false,
  },
});
