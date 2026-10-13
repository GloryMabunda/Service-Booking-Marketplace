import { formatCents, percentOf, toCents } from './money.js';

describe('toCents and formatCents', () => {
  it.each([
    ['650.00', 65000],
    ['650', 65000],
    ['650.5', 65050],
    ['0.01', 1],
    ['0', 0],
    ['1200.99', 120099],
  ])('reads %s as %i cents', (amount, cents) => {
    expect(toCents(amount)).toBe(cents);
  });

  it.each(['', '-5', '6.505', '1,200.00', 'R650', '12.', '.5'])(
    'rejects %j',
    (amount) => {
      expect(() => toCents(amount)).toThrow('Not a money amount');
    },
  );

  it.each([
    [65000, '650.00'],
    [1, '0.01'],
    [0, '0.00'],
    [120099, '1200.99'],
    [5, '0.05'],
  ])('writes %i cents as %s', (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
});

describe('percentOf (the deposit, BR-7)', () => {
  it.each([
    ['50.00', '650.00', '325.00'],
    ['50.00', '1200.50', '600.25'],
    ['30.00', '650.00', '195.00'],
    ['0.00', '650.00', '0.00'],
    ['100.00', '650.00', '650.00'],
    ['33.33', '100.00', '33.33'],
    ['12.50', '80.00', '10.00'],
  ])('%s%% of %s is %s', (percent, amount, expected) => {
    expect(percentOf(percent, amount)).toBe(expected);
  });

  it('rounds half-up to the cent', () => {
    // 50% of 0.01 is 0.005: rounds up to 0.01
    expect(percentOf('50.00', '0.01')).toBe('0.01');
    // 50% of 0.03 is 0.015: rounds up to 0.02
    expect(percentOf('50.00', '0.03')).toBe('0.02');
    // 33.33% of 99.99 is 33.3267: rounds to 33.33
    expect(percentOf('33.33', '99.99')).toBe('33.33');
    // 10% of 0.04 is 0.004: rounds down to 0.00
    expect(percentOf('10.00', '0.04')).toBe('0.00');
  });
});
