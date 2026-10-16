import { type Kysely, sql } from 'kysely';
import type { DB } from '../../src/database/database.types.js';
import {
  createTestDatabase,
  inRolledBackTransaction,
} from '../helpers/database.js';

// The services table's own rules (#29, docs/database.md 3.2). The database is
// the last line of defence: these hold even if application code forgets to
// check.
describe('services table constraints', () => {
  let db: Kysely<DB>;

  beforeAll(() => {
    db = createTestDatabase();
  });

  afterAll(async () => {
    await db.destroy();
  });

  const valid = {
    name: 'Standard Clean',
    description: 'Natural, glowing makeup.',
    price: '650.00',
    duration_minutes: 90,
  };

  // Runs an insert that should fail, inside a savepoint so the transaction
  // stays usable, and returns the PostgreSQL error.
  async function insertError(
    trx: Kysely<DB>,
    values: typeof valid,
  ): Promise<{ code: string; constraint: string }> {
    await sql`SAVEPOINT attempt`.execute(trx);
    try {
      await trx.insertInto('services').values(values).execute();
    } catch (error) {
      await sql`ROLLBACK TO SAVEPOINT attempt`.execute(trx);
      return error as { code: string; constraint: string };
    }
    throw new Error('the insert was expected to fail');
  }

  it('stores a valid service, active by default', async () => {
    await inRolledBackTransaction(db, async (trx) => {
      const row = await trx
        .insertInto('services')
        .values(valid)
        .returningAll()
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        name: 'Standard Clean',
        price: '650.00',
        duration_minutes: 90,
        is_active: true,
      });
    });
  });

  it.each([
    ['a negative price', { price: '-0.01' }, 'services_price_check'],
    [
      'a zero duration',
      { duration_minutes: 0 },
      'services_duration_minutes_check',
    ],
    [
      'a duration over 12 hours',
      { duration_minutes: 721 },
      'services_duration_minutes_check',
    ],
    ['an empty name', { name: '' }, 'services_name_check'],
    ['a 101-character name', { name: 'x'.repeat(101) }, 'services_name_check'],
    [
      'a 2,001-character description',
      { description: 'x'.repeat(2001) },
      'services_description_length',
    ],
  ])('rejects %s', async (_label, change, constraint) => {
    await inRolledBackTransaction(db, async (trx) => {
      const error = await insertError(trx, { ...valid, ...change });
      expect(error).toMatchObject({ code: '23514', constraint }); // check_violation
    });
  });

  it('rejects a second service with the same name, ignoring capitals', async () => {
    await inRolledBackTransaction(db, async (trx) => {
      await trx.insertInto('services').values(valid).execute();
      const error = await insertError(trx, {
        ...valid,
        name: 'STANDARD clean',
      });
      expect(error).toMatchObject({
        code: '23505', // unique_violation
        constraint: 'services_name_key',
      });
    });
  });
});
