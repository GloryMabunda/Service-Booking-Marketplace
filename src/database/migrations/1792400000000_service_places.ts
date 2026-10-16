import { type Kysely, sql } from 'kysely';

// Where a service can be done: at the owner's place, at the client's place, or
// both. Until now every service could be done at the owner's place, and the
// client's place was an extra (available_for_travel). A cleaner only ever goes
// to the client, so "at our place" becomes a switch of its own. A service must
// be done somewhere.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE services
      ADD COLUMN available_at_our_place boolean NOT NULL DEFAULT true,
      ADD CONSTRAINT services_some_place
        CHECK (available_at_our_place OR available_for_travel);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE services
      DROP CONSTRAINT services_some_place,
      DROP COLUMN available_at_our_place;
  `.execute(db);
}
