import { calculateSlots, overlaps, type SlotInput } from './slots.js';
import { zonedTimeToUtc } from './time-zone.js';

const SA = 'Africa/Johannesburg';
const DATE = '2026-11-03'; // a Tuesday

// A local time on DATE as a UTC Date
const at = (time: string) => zonedTimeToUtc(DATE, time, SA);
const interval = (start: string, end: string) => ({
  start: at(start),
  end: at(end),
});

// The reference business: 09:00-17:00, a 90-minute service, hourly starts,
// a 60-minute buffer, nothing booked, and an open booking window.
const base: SlotInput = {
  date: DATE,
  timeZone: SA,
  hours: { start: '09:00', end: '17:00' },
  durationMinutes: 90,
  slotIntervalMinutes: 60,
  bufferMinutes: 60,
  busy: [],
  earliestStart: new Date('2026-01-01T00:00:00Z'),
  latestStart: new Date('2027-12-31T00:00:00Z'),
};

const times = (input: Partial<SlotInput>) =>
  calculateSlots({ ...base, ...input }).map((slot) => slot.localTime);

describe('calculateSlots', () => {
  describe('working hours and the slot interval', () => {
    it('offers hourly starts, the last appointment ending by closing time', () => {
      // 15:00 ends 16:30; 16:00 would end 17:30, after closing.
      expect(times({})).toEqual([
        '09:00',
        '10:00',
        '11:00',
        '12:00',
        '13:00',
        '14:00',
        '15:00',
      ]);
    });

    it('offers nothing on a day off', () => {
      expect(times({ hours: null })).toEqual([]);
    });

    it('follows a 30-minute interval, counted from opening time', () => {
      expect(times({ durationMinutes: 60, slotIntervalMinutes: 30 })).toEqual([
        '09:00',
        '09:30',
        '10:00',
        '10:30',
        '11:00',
        '11:30',
        '12:00',
        '12:30',
        '13:00',
        '13:30',
        '14:00',
        '14:30',
        '15:00',
        '15:30',
        '16:00',
      ]);
    });

    it('counts the grid from an opening time that is not on the hour', () => {
      expect(
        times({ hours: { start: '08:15', end: '11:15' }, durationMinutes: 60 }),
      ).toEqual(['08:15', '09:15', '10:15']);
    });

    it('allows an appointment that ends exactly at closing time', () => {
      expect(times({ durationMinutes: 60 })).toContain('16:00');
    });

    it('offers nothing when the service is longer than the working day', () => {
      expect(times({ durationMinutes: 9 * 60 })).toEqual([]);
    });

    it('returns each slot with its end, its buffer end and UTC instants', () => {
      const [first, , , , , , last] = calculateSlots(base);
      expect(first.startAt.toISOString()).toBe('2026-11-03T07:00:00.000Z');
      expect(first.endAt.toISOString()).toBe('2026-11-03T08:30:00.000Z');
      expect(first.occupiedUntil.toISOString()).toBe(
        '2026-11-03T09:30:00.000Z',
      );
      expect(last.localTime).toBe('15:00');
    });
  });

  describe('the buffer after the last booking may run past closing (BR-13)', () => {
    it('still offers the last slot although its buffer ends after 17:00', () => {
      const last = calculateSlots(base).at(-1)!;
      expect(last.localTime).toBe('15:00');
      expect(last.endAt).toEqual(at('16:30')); // within working hours
      expect(last.occupiedUntil).toEqual(at('17:30')); // past closing
    });
  });

  describe('bookings and blocked time', () => {
    it('excludes starts whose appointment or buffer would overlap a booking', () => {
      // Booked 11:00-12:30, so busy until 13:30 with its buffer. A new
      // appointment at 09:00 (buffer to 11:30) would collide with it.
      expect(times({ busy: [interval('11:00', '13:30')] })).toEqual([
        '14:00',
        '15:00',
      ]);
    });

    it('allows the next start exactly when the previous booking and buffer end', () => {
      expect(
        times({
          durationMinutes: 60,
          slotIntervalMinutes: 30,
          busy: [interval('11:00', '13:30')], // 12:00 appointment + 90? ends 13:30
        }),
      ).toEqual(expect.arrayContaining(['13:30', '14:00']));
      expect(
        times({
          durationMinutes: 60,
          slotIntervalMinutes: 30,
          busy: [interval('11:00', '13:30')],
        }),
      ).not.toContain('13:00');
    });

    it('allows an appointment whose buffer ends exactly when a booking starts', () => {
      // 09:00 appointment (90 min) + 60 min buffer ends 11:30.
      expect(times({ busy: [interval('11:30', '14:00')] })).toContain('09:00');
      expect(times({ busy: [interval('11:29', '14:00')] })).not.toContain(
        '09:00',
      );
    });

    it('excludes starts that would overlap blocked time, buffer included', () => {
      // Blocked 12:00-13:00: starts 09:00 (to 11:30) fits; 10:00 (buffer to
      // 12:30) collides; 12:00 and 13:00 (13:00 is free to start) ...
      expect(times({ busy: [interval('12:00', '13:00')] })).toEqual([
        '09:00',
        '13:00',
        '14:00',
        '15:00',
      ]);
    });

    it('excludes everything when the whole day is blocked', () => {
      expect(times({ busy: [interval('00:00', '23:59')] })).toEqual([]);
    });

    it('ignores bookings and blocked time on other days', () => {
      const other = {
        start: zonedTimeToUtc('2026-11-04', '09:00', SA),
        end: zonedTimeToUtc('2026-11-04', '17:00', SA),
      };
      expect(times({ busy: [other] })).toHaveLength(7);
    });
  });

  describe('the booking window (BR-9, BR-10)', () => {
    it('hides starts before the earliest allowed time, keeping that moment itself', () => {
      expect(times({ earliestStart: at('11:00') })).toEqual([
        '11:00',
        '12:00',
        '13:00',
        '14:00',
        '15:00',
      ]);
      expect(times({ earliestStart: at('11:01') })).toEqual([
        '12:00',
        '13:00',
        '14:00',
        '15:00',
      ]);
    });

    it('hides starts after the latest allowed time, keeping that moment itself', () => {
      expect(times({ latestStart: at('12:00') })).toEqual([
        '09:00',
        '10:00',
        '11:00',
        '12:00',
      ]);
      expect(times({ latestStart: at('11:59') })).toEqual([
        '09:00',
        '10:00',
        '11:00',
      ]);
    });

    it('offers nothing for a day outside the window', () => {
      expect(times({ earliestStart: at('23:00') })).toEqual([]);
      expect(
        times({ latestStart: zonedTimeToUtc('2026-11-02', '09:00', SA) }),
      ).toEqual([]);
    });
  });
});

describe('overlaps', () => {
  const make = (a: number, b: number) => ({
    start: new Date(a),
    end: new Date(b),
  });
  it('is true for intervals that share time', () => {
    expect(overlaps(make(0, 10), make(5, 15))).toBe(true);
    expect(overlaps(make(0, 10), make(2, 3))).toBe(true);
  });
  it('is false for intervals that only touch', () => {
    expect(overlaps(make(0, 10), make(10, 20))).toBe(false);
    expect(overlaps(make(10, 20), make(0, 10))).toBe(false);
  });
});

describe('calculateSlots with travel time (#115)', () => {
  it('keeps travel time clear on both sides of an existing booking', () => {
    // One hour appointments, no buffer, someone already booked 12:00-13:00
    const input = {
      durationMinutes: 60,
      bufferMinutes: 0,
      busy: [interval('12:00', '13:00')],
    };
    // At the owner's place, 11:00 and 13:00 fit right up against it
    expect(times(input)).toEqual(expect.arrayContaining(['11:00', '13:00']));
    // With 30 minutes of travel each way they no longer do
    const withTravel = times({ ...input, travelMinutes: 30 });
    expect(withTravel).not.toContain('11:00');
    expect(withTravel).not.toContain('13:00');
    expect(withTravel).toEqual(expect.arrayContaining(['10:00', '14:00']));
  });

  it('offers fewer start times than at the owner’s place when the day is busy', () => {
    const busy = [interval('12:00', '14:00')];
    expect(times({ busy, travelMinutes: 30 }).length).toBeLessThanOrEqual(
      times({ busy }).length,
    );
    expect(times({ busy, travelMinutes: 30 })).not.toContain('11:00');
  });

  it('reports the span a booking would occupy, travel included', () => {
    const [slot] = calculateSlots({ ...base, travelMinutes: 30 });
    // 09:00 start, 90 minutes + 60 buffer + 30 travel after
    expect(slot.occupiedUntil.getTime() - at('09:00').getTime()).toBe(
      (90 + 60 + 30) * 60_000,
    );
  });
});
