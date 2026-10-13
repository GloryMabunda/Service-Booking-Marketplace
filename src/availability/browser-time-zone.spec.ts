import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  addDays,
  isoDayOfWeek,
  localDate,
  localTime,
  zonedTimeToUtc,
} from './time-zone.js';

// public/js/time-zone.js is the browser's copy of time-zone.ts. The two must
// give the same answers, especially around midnight and clock changes.
interface BrowserTimeZone {
  zonedTimeToUtc(date: string, time: string, zone: string): Date;
  addDays(date: string, days: number): string;
  localDate(instant: Date, zone: string): string;
  localTime(instant: Date, zone: string): string;
  isoDayOfWeek(date: string): number;
  formatDay(date: string): string;
}

describe('public/js/time-zone.js matches the server (time-zone.ts)', () => {
  let browser: BrowserTimeZone;

  beforeAll(async () => {
    const file = resolve('public/js/time-zone.js');
    const imported: unknown = await import(pathToFileURL(file).href);
    browser = imported as BrowserTimeZone;
  });

  const zones = [
    'Africa/Johannesburg',
    'Europe/London', // clocks change 29 March and 25 October 2026
    'America/New_York', // 8 March and 1 November 2026
    'Australia/Sydney', // 4 October 2026 and 5 April 2026
    'Asia/Kolkata', // a half-hour offset
    'UTC',
  ];
  const dates = [
    '2026-01-15',
    '2026-03-08',
    '2026-03-29',
    '2026-04-05',
    '2026-10-04',
    '2026-10-25',
    '2026-11-01',
    '2026-12-31',
    '2028-02-29',
  ];
  const times = ['00:00', '00:30', '01:30', '02:30', '09:00', '17:00', '23:59'];

  it('turns local times into the same UTC instants, including during clock changes', () => {
    for (const zone of zones) {
      for (const date of dates) {
        for (const time of times) {
          expect(browser.zonedTimeToUtc(date, time, zone).toISOString()).toBe(
            zonedTimeToUtc(date, time, zone).toISOString(),
          );
        }
      }
    }
  });

  it('reads the same local date and time back', () => {
    const instant = new Date('2026-10-09T22:30:00Z');
    for (const zone of zones) {
      expect(browser.localDate(instant, zone)).toBe(localDate(instant, zone));
      expect(browser.localTime(instant, zone)).toBe(localTime(instant, zone));
    }
    expect(browser.localDate(instant, 'Africa/Johannesburg')).toBe(
      '2026-10-10',
    );
    expect(browser.localTime(instant, 'Africa/Johannesburg')).toBe('00:30');
  });

  it('does the same calendar arithmetic', () => {
    for (const date of dates) {
      expect(browser.addDays(date, 1)).toBe(addDays(date, 1));
      expect(browser.addDays(date, -30)).toBe(addDays(date, -30));
      expect(browser.isoDayOfWeek(date)).toBe(isoDayOfWeek(date));
    }
  });

  it('writes a calendar day for people without shifting it', () => {
    expect(browser.formatDay('2026-11-03')).toMatch(/Tuesday.*3.*November/);
    expect(browser.formatDay('2026-01-01')).toMatch(/Thursday.*1.*January/);
  });
});
