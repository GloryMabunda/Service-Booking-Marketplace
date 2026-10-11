import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { envFileValues } from './test/setup/env-file.js';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Variables from .env, unless already set in the real environment (#20).
    env: envFileValues(),
    // Migrates the test database before the tests run (#19).
    globalSetup: ['./test/setup/migrate-test-database.ts'],
  },
});
