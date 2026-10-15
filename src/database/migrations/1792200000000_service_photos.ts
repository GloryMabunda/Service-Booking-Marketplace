import { type Kysely, sql } from 'kysely';

// A picture for each service (the services page and the home page show it).
// The owner uploads it; it is one of the website photos in the images table,
// so deleting that photo just empties the column.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE services
      ADD COLUMN image_id uuid REFERENCES images (id) ON DELETE SET NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE services DROP COLUMN image_id`.execute(db);
}
