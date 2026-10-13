// Time zone helpers for the browser (#40, #41). The server keeps all times in
// UTC and the business works in its own time zone (settings.timeZone, BR-6),
// so pages turn "Tuesday 09:00 in Johannesburg" into a UTC instant and back.
//
// This mirrors src/availability/time-zone.ts; a unit test
// (src/availability/browser-time-zone.spec.ts) checks the two agree across
// many dates and zones, including days when clocks change.

const DAY_MS = 86_400_000;

// A zone's offset from UTC at an instant, in milliseconds (+2 h for Johannesburg)
function offsetMs(instant, timeZone) {
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
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// "2026-11-03" + "09:00" in a zone → the UTC instant (a Date)
export function zonedTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const before = offsetMs(wallClockAsUtc - DAY_MS, timeZone);
  const after = offsetMs(wallClockAsUtc + DAY_MS, timeZone);
  const valid = [wallClockAsUtc - before, wallClockAsUtc - after].filter(
    (instant) => offsetMs(instant, timeZone) === wallClockAsUtc - instant,
  );
  return new Date(valid.length ? Math.min(...valid) : wallClockAsUtc - before);
}

// "YYYY-MM-DD" plus a number of days
export function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

// The calendar day of an instant in the zone: "2026-11-03"
export function localDate(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

// The wall clock time of an instant in the zone: "09:00"
export function localTime(instant, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

// 1 = Monday … 7 = Sunday
export function isoDayOfWeek(date) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

// A calendar day written for people: "Tuesday 13 October". The day is a plain
// calendar date, so it is formatted in UTC to avoid any shifting.
export function formatDay(
  date,
  options = { weekday: 'long', day: 'numeric', month: 'long' },
) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-ZA', {
    ...options,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

// "SAST" for Africa/Johannesburg: the short name of the zone
export function zoneShortName(timeZone, instant = new Date()) {
  return (
    new Intl.DateTimeFormat('en-ZA', { timeZone, timeZoneName: 'short' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value ?? timeZone
  );
}
