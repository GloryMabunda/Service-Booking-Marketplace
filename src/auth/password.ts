import argon2 from 'argon2';

// Passwords are stored only as Argon2id hashes (#26), the first choice in the
// OWASP Password Storage Cheat Sheet. The hash string records its own salt
// and cost settings, so the settings can be raised later without breaking
// existing hashes. The library defaults (64 MiB memory, 3 passes, 4 lanes)
// are above OWASP's minimums.
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

// True only for the right password. A malformed or empty hash counts as a
// wrong password, so a broken row can never let someone in or crash login.
export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
