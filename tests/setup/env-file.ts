import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// The variables from .env that aren't already set in the real environment, so
// tests see the same configuration as the app (#20) and CI settings still win.
export function envFileValues(path = '.env'): Record<string, string> {
  if (!existsSync(path)) return {};
  const values = parseEnv(readFileSync(path, 'utf8'));
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && process.env[entry[0]] === undefined,
    ),
  );
}
