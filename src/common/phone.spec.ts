import { normalizeSouthAfricanPhone } from './phone.js';

describe('normalizeSouthAfricanPhone', () => {
  it.each([
    ['082 123 4567', '+27821234567'],
    ['0821234567', '+27821234567'],
    ['+27 82 123 4567', '+27821234567'],
    ['+27821234567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['(082) 123-4567', '+27821234567'],
    ['011 234 5678', '+27112345678'],
    ['+27 (0)82 123 4567', '+27821234567'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeSouthAfricanPhone(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['12345', 'too short'],
    ['082 123 45678', 'too long'],
    ['+44 20 7946 0958', 'not South African'],
    ['0021234567', 'no area code starts with 0'],
    ['0921234567', 'no number starts with 09'],
    ['082 ABC 4567', 'letters'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizeSouthAfricanPhone(input)).toBeNull();
  });
});
