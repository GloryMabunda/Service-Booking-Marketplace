import type { Settings } from './settings.schema.js';

// The range of start times a client can book (C-2, BR-9, BR-10), returned
// with the service list so the date picker can grey out every other date.
export interface BookingWindow {
  timeZone: string;
  earliestStartAt: string; // ISO 8601 in UTC
  latestStartAt: string;
  firstDate: string; // YYYY-MM-DD, a calendar day in the business time zone
  lastDate: string;
}

const HOUR_MS = 3_600_000;

type WindowSettings = Pick<
  Settings,
  | 'minNoticeHours'
  | 'maxAdvanceDays'
  | 'minPaymentWindowHours'
  | 'depositPercent'
  | 'timeZone'
>;

// Earliest start: now plus the minimum notice (BR-10), plus the minimum
// payment window when a deposit applies, so the client always has time to pay
// before the appointment (BR-9). Latest start: now plus the advance window.
export function bookingWindow(
  now: Date,
  settings: WindowSettings,
): BookingWindow {
  const depositApplies = Number(settings.depositPercent) > 0;
  const earliest = new Date(
    now.getTime() +
      (settings.minNoticeHours +
        (depositApplies ? settings.minPaymentWindowHours : 0)) *
        HOUR_MS,
  );
  const latest = new Date(
    now.getTime() + settings.maxAdvanceDays * 24 * HOUR_MS,
  );
  return {
    timeZone: settings.timeZone,
    earliestStartAt: toIsoSeconds(earliest),
    latestStartAt: toIsoSeconds(latest),
    firstDate: calendarDay(earliest, settings.timeZone),
    lastDate: calendarDay(latest, settings.timeZone),
  };
}

// "2026-10-11T12:00:00Z", without milliseconds (docs/api.md section 1).
function toIsoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// The calendar day of an instant in a time zone. The "en-CA" locale writes
// dates as YYYY-MM-DD.
function calendarDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
