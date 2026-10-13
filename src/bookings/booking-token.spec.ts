import { createHash } from 'node:crypto';
import {
  bookingLink,
  generateBookingToken,
  hashBookingToken,
} from './booking-token.js';

describe('booking link token (BR-15, #47)', () => {
  it('is 32 random bytes written as 43 URL-safe characters', () => {
    const token = generateBookingToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('is different every time', () => {
    const tokens = new Set(
      Array.from({ length: 1000 }, () => generateBookingToken()),
    );
    expect(tokens.size).toBe(1000);
  });

  it('uses all 256 bits: no fixed or repeating bytes', () => {
    const bytes = Buffer.from(generateBookingToken(), 'base64url');
    expect(new Set(bytes).size).toBeGreaterThan(10);
  });

  describe('hashBookingToken', () => {
    it('is the 32-byte SHA-256 of the token', () => {
      const token = generateBookingToken();
      const hash = hashBookingToken(token);
      expect(hash).toHaveLength(32);
      expect(hash.equals(createHash('sha256').update(token).digest())).toBe(
        true,
      );
    });

    it('is the same for the same token and different for another', () => {
      const a = generateBookingToken();
      const b = generateBookingToken();
      expect(hashBookingToken(a).equals(hashBookingToken(a))).toBe(true);
      expect(hashBookingToken(a).equals(hashBookingToken(b))).toBe(false);
    });

    it('does not contain the token', () => {
      const token = generateBookingToken();
      const hash = hashBookingToken(token);
      expect(hash.toString('base64url')).not.toContain(token);
      expect(hash.toString('hex')).not.toContain(
        Buffer.from(token, 'base64url').toString('hex'),
      );
    });
  });

  describe('bookingLink', () => {
    it('builds /booking/<token> on the site address', () => {
      expect(bookingLink('https://makeupbyglory.example', 'abc')).toBe(
        'https://makeupbyglory.example/booking/abc',
      );
    });

    it('ignores a trailing slash on the site address', () => {
      expect(bookingLink('http://localhost:3000/', 'abc')).toBe(
        'http://localhost:3000/booking/abc',
      );
    });
  });
});
