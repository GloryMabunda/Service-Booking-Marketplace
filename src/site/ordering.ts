import { ApiException } from '../common/api-error.js';

// Checks a "set the display order" request: the ids must be every item
// exactly once. Throws 400 VALIDATION_FAILED otherwise (docs/api.md 7.17).
export function assertSameIds(requested: string[], existing: string[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const id of requested) {
    if (seen.has(id)) problems.push(`${id} is listed more than once.`);
    seen.add(id);
  }
  const known = new Set(existing);
  for (const id of seen) {
    if (!known.has(id)) problems.push(`${id} is not one of the items.`);
  }
  for (const id of existing) {
    if (!seen.has(id)) problems.push(`${id} is missing from the list.`);
  }
  if (problems.length > 0) {
    throw new ApiException(
      400,
      'VALIDATION_FAILED',
      'Some details are missing or invalid.',
      [{ field: 'ids', message: problems.slice(0, 3).join(' ') }],
    );
  }
}
