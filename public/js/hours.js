// Working hours for the home page (C-9, #105): the seven days from
// GET /api/site, with consecutive days that have the same hours joined, so
// "Monday to Friday, 09:00 to 17:00" is one row instead of five.

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

// What a day's hours look like, as text. Closed days read "Closed".
function hoursOf(day) {
  return day.isWorkingDay && day.startTime && day.endTime
    ? `${day.startTime}–${day.endTime}`
    : 'Closed';
}

// [{ label: "Mon–Fri", hours: "09:00–17:00" }, { label: "Sunday", hours: "Closed" }]
// `days` have dayOfWeek 1 (Monday) to 7 (Sunday), in any order.
export function groupHours(days) {
  const sorted = [...days].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const groups = [];
  for (const day of sorted) {
    const hours = hoursOf(day);
    const last = groups[groups.length - 1];
    if (last && last.hours === hours && last.to === day.dayOfWeek - 1) {
      last.to = day.dayOfWeek;
    } else {
      groups.push({ from: day.dayOfWeek, to: day.dayOfWeek, hours });
    }
  }
  return groups.map(({ from, to, hours }) => ({
    label: from === to ? LONG[from - 1] : `${SHORT[from - 1]}–${SHORT[to - 1]}`,
    hours,
  }));
}

// True when at least one day is a working day
export function hasWorkingDays(days) {
  return days.some((day) => day.isWorkingDay);
}
