import { defineConfig } from 'vitest/config';

// Unit tests (npm test): one piece of logic at a time, next to the code it
// tests, with no database, network or .env. They should take milliseconds.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
