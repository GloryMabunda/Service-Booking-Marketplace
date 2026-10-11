// Configuration for kysely-ctl, the migration command-line tool (issue #19).
//
//   npm run db:migrate                  apply new migrations to the development database
//   npm run db:migrate:test             the same for the test database
//   npm run db:migrate:make -- <name>   create a new, empty migration file
//   npm run db:migrate:down             undo the most recent migration
//   npm run db:migrate:list             show which migrations have run
//
// The connection strings default to the local Docker database (docker-compose.yml).
// DATABASE_URL and TEST_DATABASE_URL override them; #20 moves them into .env.
import { PostgresDialect } from 'kysely';
import { defineConfig } from 'kysely-ctl';
import pg from 'pg';

const DEV_URL = 'postgres://booking:booking@localhost:5432/booking';
const TEST_URL = 'postgres://booking:booking@localhost:5432/booking_test';

function dialect(connectionString: string) {
  return new PostgresDialect({ pool: new pg.Pool({ connectionString }) });
}

export default defineConfig({
  dialect: dialect(process.env.DATABASE_URL ?? DEV_URL),
  migrations: {
    migrationFolder: 'src/database/migrations',
  },
  // Selected with --environment test (see the db:migrate:test script).
  $test: {
    dialect: dialect(process.env.TEST_DATABASE_URL ?? TEST_URL),
  },
});
