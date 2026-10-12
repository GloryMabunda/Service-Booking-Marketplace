import { type Kysely, sql } from 'kysely';
import type { DB } from '../../src/database/database.types.js';
import {
  createTestDatabase,
  inRolledBackTransaction,
} from '../helpers/database.js';

// Example integration test (#21): checks the migrated test database (#19).
// Each test runs inside a transaction that is rolled back.
describe('Database schema', () => {
  let db: Kysely<DB>;

  beforeAll(() => {
    db = createTestDatabase();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('has the btree_gist extension', async () => {
    const { rows } = await sql<{
      extname: string;
    }>`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`.execute(
      db,
    );
    expect(rows).toHaveLength(1);
  });

  it('rejects overlapping active bookings and allows back-to-back ones (BR-2)', async () => {
    await inRolledBackTransaction(db, async (trx) => {
      const service = await trx
        .insertInto('services')
        .values({ name: 'Soft Glam', price: '650.00', duration_minutes: 90 })
        .returning('id')
        .executeTakeFirstOrThrow();

      const booking = (start: string, end: string) => ({
        service_id: service.id,
        client_name: 'Test Client',
        client_email: 'client@example.com',
        client_phone: '+27821234567',
        start_at: start,
        end_at: end,
        occupied_until: end,
        price_at_booking: '650.00',
        deposit_amount: '325.00',
        deposit_due_at: '2026-10-12T09:00:00+02:00',
        status: 'pending' as const,
      });

      const first = await trx
        .insertInto('bookings')
        .values(
          booking('2026-10-13T09:00:00+02:00', '2026-10-13T11:00:00+02:00'),
        )
        .returning('reference')
        .executeTakeFirstOrThrow();
      expect(first.reference).toMatch(/^BK-\d{6}$/);

      // Back-to-back: starts exactly when the first one ends.
      await trx
        .insertInto('bookings')
        .values(
          booking('2026-10-13T11:00:00+02:00', '2026-10-13T12:00:00+02:00'),
        )
        .execute();

      // Overlapping: the savepoint keeps the transaction usable after the error.
      await sql`SAVEPOINT overlap`.execute(trx);
      await expect(
        trx
          .insertInto('bookings')
          .values(
            booking('2026-10-13T10:00:00+02:00', '2026-10-13T12:00:00+02:00'),
          )
          .execute(),
      ).rejects.toMatchObject({
        code: '23P01',
        constraint: 'bookings_no_overlap',
      });
      await sql`ROLLBACK TO SAVEPOINT overlap`.execute(trx);
    });
  });
});
