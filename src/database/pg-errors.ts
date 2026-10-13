// Recognising PostgreSQL errors by their SQLSTATE code (docs/database.md), so
// code can turn a constraint failure into a friendly API error.

interface PgError {
  code: string;
  constraint?: string;
}

function asPgError(error: unknown): PgError | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as Record<string, unknown>;
  if (typeof code !== 'string') return null;
  return {
    code,
    constraint: typeof constraint === 'string' ? constraint : undefined,
  };
}

// True when `error` is a PostgreSQL error with this code and, if given, this
// constraint name. Examples: 23505 unique_violation, 23P01 exclusion_violation.
export function isPgError(
  error: unknown,
  code: string,
  constraint?: string,
): boolean {
  const pg = asPgError(error);
  return (
    pg !== null &&
    pg.code === code &&
    (!constraint || pg.constraint === constraint)
  );
}

// A row can't be deleted because other rows still reference it
// (foreign key ... ON DELETE RESTRICT). PostgreSQL reports this as 23001
// (restrict_violation) or, for some paths, 23503 (foreign_key_violation).
export function isRestrictViolation(error: unknown): boolean {
  return isPgError(error, '23001') || isPgError(error, '23503');
}
