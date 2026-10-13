import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSouthAfricanPhone } from './phone.js';

// public/js/phone.js is the booking form's copy of phone.ts: the page and the
// server must accept and reject the same numbers.
describe('public/js/phone.js matches the server (phone.ts)', () => {
  let browser: (input: string) => string | null;

  beforeAll(async () => {
    const imported: unknown = await import(
      pathToFileURL(resolve('public/js/phone.js')).href
    );
    browser = (imported as { normalizeSouthAfricanPhone: typeof browser })
      .normalizeSouthAfricanPhone;
  });

  const inputs = [
    '082 123 4567',
    '0821234567',
    '+27 82 123 4567',
    '+27821234567',
    '27821234567',
    '(082) 123-4567',
    '011 234 5678',
    '+27 (0)82 123 4567',
    '',
    '   ',
    '12345',
    '082 123 45678',
    '+44 20 7946 0958',
    '0021234567',
    '0921234567',
    '082 ABC 4567',
    '+27',
    '27',
    '0',
    '082-123-4567',
    '082.123.4567',
    '+27 082 123 4567',
    '0027821234567',
    '082 123 4567 ext 5',
    '+27 12 345 6789',
    '+27 90 123 4567',
    '0800 123 456',
    '+',
    '++27821234567',
    '082 123 456',
  ];

  it.each(inputs)('gives the same answer for %j', (input) => {
    expect(browser(input)).toBe(normalizeSouthAfricanPhone(input));
  });

  it('actually accepts and rejects (not just null for both)', () => {
    expect(browser('082 123 4567')).toBe('+27821234567');
    expect(browser('+44 20 7946 0958')).toBeNull();
  });
});
