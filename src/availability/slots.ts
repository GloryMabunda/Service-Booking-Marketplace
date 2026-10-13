import { localTime, zonedTimeToUtc } from './time-zone.js';

// Slot calculation (BR-1, BR-10, BR-13, #37, #38): which start times are
// offered for a service on a day. Pure logic: the caller (AvailabilityService)
// gathers the working hours, existing bookings, blocked times and the booking
// window from the database and settings, and passes them in.

export interface Interval {
  start: Date;
  end: Date;
}

export interface SlotInput {
  date: string; // the calendar day, YYYY-MM-DD in the business time zone
  timeZone: string;
  // That weekday's working hours as "HH:mm" local times, or null on a day off
  hours: { start: string; end: string } | null;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  // Time already taken: each Pending or Confirmed booking from its start to
  // occupied_until (its buffer included), and every blocked time.
  busy: Interval[];
  // The booking window (BR-10, BR-9): no earlier than earliestStart, no later
  // than latestStart.
  earliestStart: Date;
  latestStart: Date;
}

export interface Slot {
  startAt: Date;
  endAt: Date; // the appointment's end, without the buffer
  occupiedUntil: Date; // endAt plus the buffer: what the booking will block
  localTime: string; // "09:00" in the business time zone
}

const MINUTE_MS = 60_000;

// Two half-open intervals [start, end) overlap when each starts before the
// other ends, so one booking ending exactly when another starts is fine.
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function calculateSlots(input: SlotInput): Slot[] {
  if (!input.hours) return []; // not a working day

  const dayStart = zonedTimeToUtc(
    input.date,
    input.hours.start,
    input.timeZone,
  );
  const dayEnd = zonedTimeToUtc(input.date, input.hours.end, input.timeZone);
  const slots: Slot[] = [];

  // Start times fall on the slot interval, counted from opening time.
  for (
    let t = dayStart.getTime();
    t + input.durationMinutes * MINUTE_MS <= dayEnd.getTime();
    t += input.slotIntervalMinutes * MINUTE_MS
  ) {
    const startAt = new Date(t);
    // The appointment must end within working hours (the loop condition); the
    // buffer after it may run past closing time (BR-13).
    const endAt = new Date(t + input.durationMinutes * MINUTE_MS);
    const occupiedUntil = new Date(
      endAt.getTime() + input.bufferMinutes * MINUTE_MS,
    );

    if (startAt < input.earliestStart || startAt > input.latestStart) continue;
    // The whole span, buffer included, must be free of bookings and blocked time.
    const span = { start: startAt, end: occupiedUntil };
    if (input.busy.some((interval) => overlaps(span, interval))) continue;

    slots.push({
      startAt,
      endAt,
      occupiedUntil,
      localTime: localTime(startAt, input.timeZone),
    });
  }
  return slots;
}
