import { createHash, randomBytes } from 'node:crypto';

// The booking link token (BR-15, #47). The link /booking/<token> is how a
// client opens, pays for and cancels their booking, so the token must be
// impossible to guess and impossible to recover from the database:
//
//   - 32 random bytes from the operating system's secure generator (256 bits)
//   - only its SHA-256 hash is ever stored, so a copy of the database holds no
//     working links
//   - the token itself exists only in memory, long enough to be put into the
//     booking email; no API response contains it

const TOKEN_BYTES = 32;

// A new token, written in base64url (43 characters, safe in a URL)
export function generateBookingToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

// The 32-byte SHA-256 hash that is stored and looked up
export function hashBookingToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

// The link a client is sent, for a given site address like "https://example.com"
export function bookingLink(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/booking/${token}`;
}
