import { type Kysely, sql } from 'kysely';

// The single home page content row (#104): empty, so the home page starts with
// nothing to show and the owner fills it in from the portal. Sections with no
// content are hidden.
export async function up(db: Kysely<any>): Promise<void> {
  await db
    .insertInto('site_content')
    .values({ id: 1, about_text: '' })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM site_content WHERE id = 1`.execute(db);
}
