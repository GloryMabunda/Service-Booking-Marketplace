import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Day {
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
}
interface Row {
  label: string;
  hours: string;
}

// public/js/hours.js groups the working hours on the home page (#105)
describe('public/js/hours.js', () => {
  let groupHours: (days: Day[]) => Row[];
  let hasWorkingDays: (days: Day[]) => boolean;

  beforeAll(async () => {
    const imported = (await import(
      pathToFileURL(resolve('public/js/hours.js')).href
    )) as {
      groupHours: typeof groupHours;
      hasWorkingDays: typeof hasWorkingDays;
    };
    groupHours = imported.groupHours;
    hasWorkingDays = imported.hasWorkingDays;
  });

  const open = (dayOfWeek: number, start = '09:00', end = '17:00'): Day => ({
    dayOfWeek,
    isWorkingDay: true,
    startTime: start,
    endTime: end,
  });
  const closed = (dayOfWeek: number): Day => ({
    dayOfWeek,
    isWorkingDay: false,
    startTime: null,
    endTime: null,
  });

  it('joins consecutive days with the same hours', () => {
    expect(
      groupHours([
        open(1),
        open(2),
        open(3),
        open(4),
        open(5),
        open(6, '08:00', '14:00'),
        closed(7),
      ]),
    ).toEqual([
      { label: 'Mon–Fri', hours: '09:00–17:00' },
      { label: 'Saturday', hours: '08:00–14:00' },
      { label: 'Sunday', hours: 'Closed' },
    ]);
  });

  it('joins closed days too', () => {
    expect(
      groupHours([
        open(1),
        open(2),
        open(3),
        open(4),
        open(5),
        closed(6),
        closed(7),
      ]),
    ).toEqual([
      { label: 'Mon–Fri', hours: '09:00–17:00' },
      { label: 'Sat–Sun', hours: 'Closed' },
    ]);
  });

  it('keeps days apart when something in between differs', () => {
    expect(
      groupHours([
        open(1),
        closed(2),
        open(3),
        open(4),
        open(5),
        open(6),
        open(7),
      ]),
    ).toEqual([
      { label: 'Monday', hours: '09:00–17:00' },
      { label: 'Tuesday', hours: 'Closed' },
      { label: 'Wed–Sun', hours: '09:00–17:00' },
    ]);
  });

  it('shows every day on its own when each has different hours', () => {
    const days = [1, 2, 3, 4, 5, 6, 7].map((d) => open(d, `0${d}:00`, '17:00'));
    expect(groupHours(days)).toHaveLength(7);
  });

  it('does not depend on the order of the days', () => {
    expect(groupHours([open(3), open(1), open(2)])).toEqual([
      { label: 'Mon–Wed', hours: '09:00–17:00' },
    ]);
  });

  it('reads a working day with no times as closed', () => {
    expect(
      groupHours([
        { dayOfWeek: 1, isWorkingDay: true, startTime: null, endTime: null },
      ]),
    ).toEqual([{ label: 'Monday', hours: 'Closed' }]);
  });

  it('tells whether there are any working days at all', () => {
    expect(hasWorkingDays([closed(1), closed(2)])).toBe(false);
    expect(hasWorkingDays([closed(1), open(2)])).toBe(true);
  });
});
