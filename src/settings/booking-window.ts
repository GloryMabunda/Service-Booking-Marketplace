import { isoUtc, localDate } from '../availability/time-zone.js';
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
export function bookingWindowBounds(
  now: Date,
  settings: WindowSettings,
): { earliest: Date; latest: Date } {
  const depositApplies = Number(settings.depositPercent) > 0;
  return {
    earliest: new Date(
      now.getTime() +
        (settings.minNoticeHours +
          (depositApplies ? settings.minPaymentWindowHours : 0)) *
          HOUR_MS,
    ),
    latest: new Date(now.getTime() + settings.maxAdvanceDays * 24 * HOUR_MS),
  };
}

export function bookingWindow(
  now: Date,
  settings: WindowSettings,
): BookingWindow {
  const { earliest, latest } = bookingWindowBounds(now, settings);
  return {
    timeZone: settings.timeZone,
    earliestStartAt: isoUtc(earliest),
    latestStartAt: isoUtc(latest),
    firstDate: localDate(earliest, settings.timeZone),
    lastDate: localDate(latest, settings.timeZone),
  };
}
