import { type Kysely, sql } from 'kysely';

// The single settings row (#28), with the reference business's rules: the
// column defaults (24 h notice, 90 days ahead, hourly slots, 60 min buffer,
// 50% deposit refundable up to 24 h before, 24 h to pay, at least 2 h to pay,
// Africa/Johannesburg).
//
// Banking and contact details are placeholders on purpose: real ones must
// never be committed to Git. The owner enters them with
// PATCH /api/admin/settings (later, the portal's settings page).
const PLACEHOLDER = 'Not set yet';

export async function up(db: Kysely<any>): Promise<void> {
  await db
    .insertInto('settings')
    .values({
      id: 1,
      banking_details: JSON.stringify({
        accountName: PLACEHOLDER,
        bank: PLACEHOLDER,
        accountNumber: PLACEHOLDER,
        branchCode: PLACEHOLDER,
        accountType: PLACEHOLDER,
      }),
      // A neutral name: the owner replaces it in Settings. A fresh install
      // never carries anyone's real business name.
      business_name: 'Your Business',
      business_email: 'bookings@example.com',
      business_phone: null,
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM settings WHERE id = 1`.execute(db);
}
