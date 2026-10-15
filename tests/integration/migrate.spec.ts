import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Kysely, sql } from 'kysely';
import { createDatabase } from '../../src/database/database.js';
import type { DB } from '../../src/database/database.types.js';
import { runMigrations } from '../../src/database/migrate.js';
import { createTestDatabase } from '../helpers/database.js';

// The production migration runner (#90) in a scratch database of its own: it
// applies what is new, does nothing the second time, and when a migration
// fails it throws, with nothing from that run left half-applied, so the deploy
// can stop before the new version starts.

const create = (name: string) =>
  `export async function up(db) { await db.schema.createTable('${name}').addColumn('id', 'integer').execute(); }\n` +
  `export async function down(db) { await db.schema.dropTable('${name}').execute(); }\n`;
const broken =
  "export async function up() { throw new Error('this migration is broken'); }\n" +
  'export async function down() {}\n';

describe('runMigrations', () => {
  let admin: Kysely<DB>;
  let db: Kysely<DB>;
  let folder: string;
  let name: string;

  beforeAll(async () => {
    admin = createTestDatabase();
    name = `mig_scratch_${randomBytes(4).toString('hex')}`;
    await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
    const url = new URL(process.env.TEST_DATABASE_URL as string);
    url.pathname = `/${name}`;
    db = createDatabase(url.toString());
  });

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'mbg-migrations-'));
  });
  afterEach(() => rm(folder, { recursive: true, force: true }));

  afterAll(async () => {
    await db.destroy();
    await sql.raw(`DROP DATABASE ${name} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  });

  const tables = async () =>
    (
      await sql<{ table_name: string }>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'mig_%'
        ORDER BY table_name`.execute(db)
    ).rows.map((r) => r.table_name);

  it('applies new migrations in name order, and nothing the second time', async () => {
    await writeFile(join(folder, '002_second.js'), create('mig_two'));
    await writeFile(join(folder, '001_first.js'), create('mig_one'));
    expect(await runMigrations(db, folder)).toEqual([
      '001_first',
      '002_second',
    ]);
    expect(await tables()).toEqual(['mig_one', 'mig_two']);
    expect(await runMigrations(db, folder)).toEqual([]);
  });

  it('applies only the new one when another is added later', async () => {
    await writeFile(join(folder, '001_first.js'), create('mig_one'));
    await writeFile(join(folder, '002_second.js'), create('mig_two'));
    await writeFile(join(folder, '003_third.js'), create('mig_three'));
    expect(await runMigrations(db, folder)).toEqual(['003_third']);
    expect(await tables()).toEqual(['mig_one', 'mig_three', 'mig_two']);
  });

  it('throws when a migration fails and leaves nothing from that run applied', async () => {
    await writeFile(join(folder, '001_first.js'), create('mig_one'));
    await writeFile(join(folder, '002_second.js'), create('mig_two'));
    await writeFile(join(folder, '003_third.js'), create('mig_three'));
    await writeFile(join(folder, '004_fourth.js'), create('mig_four'));
    await writeFile(join(folder, '005_broken.js'), broken);
    await writeFile(join(folder, '006_after.js'), create('mig_after'));
    await expect(runMigrations(db, folder)).rejects.toThrow(
      /Migration 005_broken failed: this migration is broken/,
    );
    const tablesNow = await tables();
    // Nothing after the broken one ran
    expect(tablesNow).not.toContain('mig_after');
    // And the new ones from the failed run are not half-applied: 004 is
    // either all there or not there, never a table without its record
    const recorded = (
      await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db)
    ).rows.map((r) => r.name);
    expect(recorded).not.toContain('005_broken');
    expect(recorded).not.toContain('006_after');
    expect(tablesNow.includes('mig_four')).toBe(
      recorded.includes('004_fourth'),
    );
  });
});
