import { type Kysely, sql } from 'kysely';

// The seven working-hours rows, one per day of the week (#34): Monday to
// Friday 09:00-17:00, Saturday 08:00-14:00, Sunday closed. These are the
// sample hours from the wireframes; the owner sets her real hours with
// PUT /api/admin/availability (the Availability page in the portal). Times are
// local to settings.time_zone (BR-6).
export async function up(db: Kysely<any>): Promise<void> {
  await db
    .insertInto('availability')
    .values([
      {
        day_of_week: 1,
        is_working_day: true,
        start_time: '09:00',
        end_time: '17:00',
      },
      {
        day_of_week: 2,
        is_working_day: true,
        start_time: '09:00',
        end_time: '17:00',
      },
      {
        day_of_week: 3,
        is_working_day: true,
        start_time: '09:00',
        end_time: '17:00',
      },
      {
        day_of_week: 4,
        is_working_day: true,
        start_time: '09:00',
        end_time: '17:00',
      },
      {
        day_of_week: 5,
        is_working_day: true,
        start_time: '09:00',
        end_time: '17:00',
      },
      {
        day_of_week: 6,
        is_working_day: true,
        start_time: '08:00',
        end_time: '14:00',
      },
      {
        day_of_week: 7,
        is_working_day: false,
        start_time: null,
        end_time: null,
      },
    ])
    .onConflict((oc) => oc.column('day_of_week').doNothing())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM availability`.execute(db);
}
