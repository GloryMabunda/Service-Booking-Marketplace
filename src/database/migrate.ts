import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Kysely } from 'kysely';
import {
  type Migration,
  type MigrationProvider,
  Migrator,
} from 'kysely/migration';
import type { DB } from './database.types.js';

// Applies the migrations that haven't run yet (#90). Used on the server, where
// the compiled migrations are in dist/ and the development tools aren't
// installed. Returns the names it applied; throws if any migration fails, in
// which case Kysely has rolled back that migration and none after it ran.

// Reads the compiled .js migrations from a folder, in name order
class FolderProvider implements MigrationProvider {
  constructor(private readonly folder: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {};
    for (const file of (await fs.readdir(this.folder)).sort()) {
      if (!file.endsWith('.js')) continue;
      const module = (await import(
        pathToFileURL(path.join(this.folder, file)).href
      )) as Migration;
      migrations[file.replace(/\.js$/, '')] = module;
    }
    return migrations;
  }
}

export async function runMigrations(
  db: Kysely<DB>,
  folder: string,
): Promise<string[]> {
  const migrator = new Migrator({
    db,
    provider: new FolderProvider(folder),
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error) {
    const failed = results?.find((r) => r.status === 'Error');
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new Error(
      `Migration ${failed?.migrationName ?? ''} failed: ${reason}`,
    );
  }
  return (results ?? [])
    .filter((r) => r.status === 'Success')
    .map((r) => r.migrationName);
}
