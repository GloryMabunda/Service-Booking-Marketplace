import { type Kysely, sql } from 'kysely';

// Service rules from docs/api.md 7.12 that the first migration didn't enforce
// (#29): names are unique ignoring case ("Soft Glam" and "soft glam" are the
// same service), and descriptions are at most 2,000 characters.
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      String.raw`
CREATE UNIQUE INDEX services_name_key ON services (lower(name));
ALTER TABLE services
  ADD CONSTRAINT services_description_length CHECK (char_length(description) <= 2000);
`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      String.raw`
ALTER TABLE services DROP CONSTRAINT services_description_length;
DROP INDEX services_name_key;
`,
    )
    .execute(db);
}
