// Configuration for kysely-ctl, the migration command-line tool (issue #19).
//
//   npm run db:migrate                  apply new migrations to the development database
//   npm run db:migrate:test             the same for the test database
//   npm run db:migrate:make -- <name>   create a new, empty migration file
//   npm run db:migrate:down             undo the most recent migration
//   npm run db:migrate:list             show which migrations have run
//
// Connection strings come from DATABASE_URL and TEST_DATABASE_URL in .env (#20).
import { existsSync } from 'node:fs';
import { PostgresDialect } from 'kysely';
import { defineConfig } from 'kysely-ctl';
import pg from 'pg';
import { validateEnv } from './src/config/env.js';

// Real environment variables win; loadEnvFile never overwrites them.
if (existsSync('.env')) process.loadEnvFile('.env');
const env = validateEnv(process.env);

function dialect(connectionString: string) {
  return new PostgresDialect({ pool: new pg.Pool({ connectionString }) });
}

function testDatabaseUrl(): string {
  if (!env.TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is required to migrate the test database. Add it to .env (see .env.example).',
    );
  }
  return env.TEST_DATABASE_URL;
}

export default defineConfig({
  dialect: dialect(env.DATABASE_URL),
  migrations: {
    migrationFolder: 'src/database/migrations',
  },
  // Selected with --environment test (see the db:migrate:test script).
  $test: {
    get dialect() {
      return dialect(testDatabaseUrl());
    },
  },
});
