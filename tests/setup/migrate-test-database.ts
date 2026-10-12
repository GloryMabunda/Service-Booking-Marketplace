import { execSync } from 'node:child_process';

// Vitest global setup: bring the test database up to the latest migration
// before any test runs (#19), so tests never see an out-of-date schema.
// Needs the Docker database running (npm run db:up).
export default function setup(): void {
  execSync('npx kysely migrate:latest --environment test --no-outdated-check', {
    stdio: 'inherit',
  });
}
