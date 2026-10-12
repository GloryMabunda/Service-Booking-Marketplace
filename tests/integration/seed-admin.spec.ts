import type { Kysely } from 'kysely';
import { verifyPassword } from '../../src/auth/password.js';
import { seedAdmin } from '../../src/auth/seed-admin.js';
import { createSession, findSession } from '../../src/auth/sessions.js';
import type { DB } from '../../src/database/database.types.js';
import {
  createTestDatabase,
  inRolledBackTransaction,
} from '../helpers/database.js';

// npm run seed:admin creates or updates the single administrator (#26).
describe('seedAdmin', () => {
  let db: Kysely<DB>;

  beforeAll(() => {
    db = createTestDatabase();
  });

  afterAll(async () => {
    await db.destroy();
  });

  const admins = (trx: Kysely<DB>) =>
    trx.selectFrom('users').selectAll().where('role', '=', 'admin').execute();

  it('creates the admin with a hashed password', async () => {
    await inRolledBackTransaction(db, async (trx) => {
      const result = await seedAdmin(trx, {
        email: 'Owner@Example.com',
        password: 'first-password-123',
      });
      expect(result.action).toBe('created');

      const rows = await admins(trx);
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe('owner@example.com');
      expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
      expect(rows[0].password_hash).not.toContain('first-password-123');
      await expect(
        verifyPassword(rows[0].password_hash, 'first-password-123'),
      ).resolves.toBe(true);
    });
  });

  it('resets the password when run again, keeping the same account', async () => {
    await inRolledBackTransaction(db, async (trx) => {
      const first = await seedAdmin(trx, {
        email: 'owner@example.com',
        password: 'first-password-123',
      });
      const token = await createSession(trx, first.id);
      const second = await seedAdmin(trx, {
        email: 'OWNER@example.com',
        password: 'second-password-456',
      });
      expect(second).toEqual({ action: 'password-reset', id: first.id });
      // Resetting the password signs out every existing session (#27).
      await expect(findSession(trx, token)).resolves.toBeNull();

      const [admin] = await admins(trx);
      await expect(
        verifyPassword(admin.password_hash, 'second-password-456'),
      ).resolves.toBe(true);
      await expect(
        verifyPassword(admin.password_hash, 'first-password-123'),
      ).resolves.toBe(false);
    });
  });

  it('moves the single admin to a new email instead of adding a second admin', async () => {
    await inRolledBackTransaction(db, async (trx) => {
      const first = await seedAdmin(trx, {
        email: 'old@example.com',
        password: 'first-password-123',
      });
      const moved = await seedAdmin(trx, {
        email: 'new@example.com',
        password: 'second-password-456',
      });
      expect(moved).toEqual({ action: 'email-changed', id: first.id });

      const rows = await admins(trx);
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe('new@example.com');
    });
  });
});
