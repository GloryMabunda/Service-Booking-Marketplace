import {
  addDays,
  isoDayOfWeek,
  localDate,
  zonedTimeToUtc,
} from '../../src/availability/time-zone.js';

// The business time zone of the reference business
export const SA = 'Africa/Johannesburg';

// The next date, a week or more from today, that falls on this ISO weekday
// (1 = Monday … 7 = Sunday), as YYYY-MM-DD. A week ahead is comfortably
// outside the minimum notice and the payment window.
export function upcoming(isoDay: number): string {
  let date = addDays(localDate(new Date(), SA), 7);
  while (isoDayOfWeek(date) !== isoDay) date = addDays(date, 1);
  return date;
}

// A local time on a date in the business time zone, as a UTC Date
export function localAt(date: string, time: string): Date {
  return zonedTimeToUtc(date, time, SA);
}
