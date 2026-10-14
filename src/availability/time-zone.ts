// Time zone handling (BR-6, #36). Instants are stored and sent as UTC;
// working hours and calendar days are "wall clock" times in the business time
// zone (settings.timeZone, Africa/Johannesburg for the reference business).
// Everything here works for any IANA zone, including ones with daylight
// saving, even though South Africa has none.

const DAY_MS = 86_400_000;

// An offset of a zone from UTC at an instant, in milliseconds (+2 h for
// Johannesburg), found by asking Intl what the wall clock reads.
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  // Drop the milliseconds the wall clock doesn't show.
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// "2026-11-03" + "09:00" in a zone → the UTC instant. With daylight saving, a
// time that doesn't exist (the clocks jump forward over it) moves forward by
// the gap, and a time that happens twice (the clocks go back) is the first one.
export function zonedTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  // The zone's offset a day before and a day after: they differ only when the
  // clocks change around this time. Each gives a candidate instant, and a
  // candidate is right when the zone's wall clock really reads this time then.
  const before = offsetMs(wallClockAsUtc - DAY_MS, timeZone);
  const after = offsetMs(wallClockAsUtc + DAY_MS, timeZone);
  const valid = [wallClockAsUtc - before, wallClockAsUtc - after].filter(
    (instant) => offsetMs(instant, timeZone) === wallClockAsUtc - instant,
  );
  // Twice-happening time: the earlier. Time that never happens: use the
  // offset from before the change, which lands just after the gap.
  return new Date(valid.length ? Math.min(...valid) : wallClockAsUtc - before);
}

// "2026-11-03T07:00:00Z": ISO 8601 in UTC, to the second, without milliseconds
// (docs/api.md section 1). A time with milliseconds (a database `now()`) is
// cut down to the second, never rounded up.
export function isoUtc(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// The calendar day as UTC instants: midnight to the next midnight in the zone
// (a day can be 23 or 25 hours long where clocks change). Blocking a whole day
// uses this (docs/database.md 3.4).
export function localDayRange(
  date: string,
  timeZone: string,
): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(date, '00:00', timeZone),
    end: zonedTimeToUtc(addDays(date, 1), '00:00', timeZone),
  };
}

// The calendar day an instant falls on in the zone: "2026-11-03"
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

// The wall clock time of an instant in the zone: "09:00"
export function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

// Calendar arithmetic on "YYYY-MM-DD" strings; no time zone involved.
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

// 1 = Monday … 7 = Sunday (ISO 8601), the numbering of availability.day_of_week
export function isoDayOfWeek(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

// True for a real calendar date written as YYYY-MM-DD ("2026-02-30" is not).
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return addDays(date, 0) === date;
}
