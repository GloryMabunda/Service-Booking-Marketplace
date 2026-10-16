import { type Kysely, sql } from 'kysely';

// The business's own logo, uploaded by the owner in the portal (rebranding).
// It is one of the website photos in the images table, so removing that photo
// just empties the column. The logo is never a file in the repository: each
// business brings its own.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE site_content
      ADD COLUMN logo_image_id uuid REFERENCES images (id) ON DELETE SET NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE site_content DROP COLUMN logo_image_id`.execute(db);
}
