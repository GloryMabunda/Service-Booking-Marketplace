import {
  escapeHtml,
  formatRand,
  formatTime,
  formatWhen,
} from './email-format.js';

describe('formatRand', () => {
  it.each([
    ['325.00', 'R325'],
    ['1200.00', 'R1,200'],
    ['325.50', 'R325.50'],
    ['0.05', 'R0.05'],
    ['1234567.00', 'R1,234,567'],
  ])('%s is %s', (amount, expected) => {
    expect(formatRand(amount)).toBe(expected);
  });
});

describe('formatWhen and formatTime', () => {
  // 07:00 UTC is 09:00 in South Africa (UTC+2, no daylight saving)
  const start = new Date('2026-10-13T07:00:00Z');

  it('writes the day out in the business time zone', () => {
    expect(formatWhen(start, 'Africa/Johannesburg')).toBe(
      'Tuesday 13 October 2026 at 09:00',
    );
  });

  it('uses the zone it is given, not the computer’s', () => {
    expect(formatWhen(start, 'UTC')).toBe('Tuesday 13 October 2026 at 07:00');
  });

  it('moves to the next day across midnight in the business zone', () => {
    const late = new Date('2026-10-13T22:30:00Z');
    expect(formatWhen(late, 'Africa/Johannesburg')).toBe(
      'Wednesday 14 October 2026 at 00:30',
    );
  });

  it('gives just the time as HH:mm', () => {
    expect(
      formatTime(new Date('2026-10-13T08:30:00Z'), 'Africa/Johannesburg'),
    ).toBe('10:30');
  });
});

describe('escapeHtml', () => {
  it('stops a name from becoming markup', () => {
    expect(escapeHtml('<script>alert("x")</script> & \'y\'')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
    );
  });
});
