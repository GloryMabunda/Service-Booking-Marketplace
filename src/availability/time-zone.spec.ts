import {
  addDays,
  isoDayOfWeek,
  isoUtc,
  isValidDate,
  localDate,
  localDayRange,
  localTime,
  zonedTimeToUtc,
} from './time-zone.js';

const SA = 'Africa/Johannesburg'; // UTC+2 all year

describe('zonedTimeToUtc (working hours in the business time zone)', () => {
  it('turns local opening and closing times into UTC', () => {
    expect(zonedTimeToUtc('2026-11-03', '09:00', SA).toISOString()).toBe(
      '2026-11-03T07:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-11-03', '17:00', SA).toISOString()).toBe(
      '2026-11-03T15:00:00.000Z',
    );
  });

  it('crosses midnight into the previous UTC day for early local times', () => {
    // 00:30 on the 10th in Johannesburg is still the 9th in UTC.
    expect(zonedTimeToUtc('2026-10-10', '00:30', SA).toISOString()).toBe(
      '2026-10-09T22:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-10-10', '01:59', SA).toISOString()).toBe(
      '2026-10-09T23:59:00.000Z',
    );
    expect(zonedTimeToUtc('2026-10-10', '02:00', SA).toISOString()).toBe(
      '2026-10-10T00:00:00.000Z',
    );
  });

  it('keeps late local times on the same UTC day', () => {
    expect(zonedTimeToUtc('2026-10-09', '23:59', SA).toISOString()).toBe(
      '2026-10-09T21:59:00.000Z',
    );
  });

  it('crosses year ends and leap days', () => {
    expect(zonedTimeToUtc('2027-01-01', '00:00', SA).toISOString()).toBe(
      '2026-12-31T22:00:00.000Z',
    );
    expect(zonedTimeToUtc('2028-02-29', '12:00', SA).toISOString()).toBe(
      '2028-02-29T10:00:00.000Z',
    );
  });
});

describe('zonedTimeToUtc with daylight saving (zones that change their clocks)', () => {
  const LONDON = 'Europe/London'; // clocks forward 29 Mar 2026, back 25 Oct 2026

  it('uses winter and summer offsets', () => {
    expect(zonedTimeToUtc('2026-01-15', '09:00', LONDON).toISOString()).toBe(
      '2026-01-15T09:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-07-15', '09:00', LONDON).toISOString()).toBe(
      '2026-07-15T08:00:00.000Z',
    );
  });

  it('moves a time that never happens forward past the gap', () => {
    // 01:30 on 29 March doesn't exist in London: 01:00 jumps to 02:00.
    const instant = zonedTimeToUtc('2026-03-29', '01:30', LONDON);
    expect(instant.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(localTime(instant, LONDON)).toBe('02:30');
  });

  it('takes the first of a time that happens twice', () => {
    // 01:30 on 25 October happens at 00:30Z (summer) and 01:30Z (winter).
    expect(zonedTimeToUtc('2026-10-25', '01:30', LONDON).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });
});

describe('localDayRange (blocking a whole day)', () => {
  it('runs from local midnight to the next local midnight', () => {
    const { start, end } = localDayRange('2026-11-03', SA);
    expect(start.toISOString()).toBe('2026-11-02T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-03T22:00:00.000Z');
  });

  it('is 23 and 25 hours long on the days the clocks change', () => {
    const hours = (date: string) => {
      const { start, end } = localDayRange(date, 'Europe/London');
      return (end.getTime() - start.getTime()) / 3_600_000;
    };
    expect(hours('2026-03-29')).toBe(23);
    expect(hours('2026-10-25')).toBe(25);
    expect(hours('2026-06-01')).toBe(24);
  });
});

describe('localDate and localTime', () => {
  it('read the wall clock in the zone, not UTC', () => {
    const instant = new Date('2026-10-09T22:30:00Z');
    expect(localDate(instant, SA)).toBe('2026-10-10');
    expect(localTime(instant, SA)).toBe('00:30');
    expect(localDate(instant, 'UTC')).toBe('2026-10-09');
  });

  it('write midnight as 00:00, not 24:00', () => {
    expect(localTime(new Date('2026-10-09T22:00:00Z'), SA)).toBe('00:00');
  });

  it('round-trip with zonedTimeToUtc', () => {
    for (const time of ['00:00', '00:30', '09:00', '16:30', '23:59']) {
      const instant = zonedTimeToUtc('2026-11-03', time, SA);
      expect(localTime(instant, SA)).toBe(time);
      expect(localDate(instant, SA)).toBe('2026-11-03');
    }
  });
});

describe('calendar helpers', () => {
  it('addDays moves across month, year and leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('isoDayOfWeek counts Monday as 1 and Sunday as 7', () => {
    expect(isoDayOfWeek('2026-11-02')).toBe(1); // Monday
    expect(isoDayOfWeek('2026-11-07')).toBe(6); // Saturday
    expect(isoDayOfWeek('2026-11-08')).toBe(7); // Sunday
  });

  it('isValidDate accepts only real calendar dates', () => {
    expect(isValidDate('2026-11-03')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-1-1')).toBe(false);
    expect(isValidDate('tomorrow')).toBe(false);
  });
});

describe('isoUtc', () => {
  it('writes a time to the second, in UTC, as the API document says', () => {
    expect(isoUtc(new Date('2026-11-03T07:00:00Z'))).toBe(
      '2026-11-03T07:00:00Z',
    );
  });

  it('drops milliseconds, whatever they are, and never rounds up', () => {
    expect(isoUtc(new Date('2026-11-03T07:00:00.000Z'))).toBe(
      '2026-11-03T07:00:00Z',
    );
    expect(isoUtc(new Date('2026-11-03T07:00:00.731Z'))).toBe(
      '2026-11-03T07:00:00Z',
    );
    expect(isoUtc(new Date('2026-11-03T07:00:59.999Z'))).toBe(
      '2026-11-03T07:00:59Z',
    );
  });
});
