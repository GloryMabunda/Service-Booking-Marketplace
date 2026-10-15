import { z } from 'zod';
import { isValidDate } from './time-zone.js';

// Request rules for the availability endpoints (docs/api.md 4.2, 7.13, 7.14).

// --- Working hours (A-6, #34) --------------------------------------------

export interface WorkingDay {
  dayOfWeek: number; // 1 = Monday … 7 = Sunday
  isWorkingDay: boolean;
  startTime: string | null; // "HH:mm", local to the business time zone
  endTime: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = z
  .string({ error: 'Enter a time such as 09:00.' })
  .regex(HHMM, 'Enter a time such as 09:00.');

const workingDaySchema = z
  .strictObject({
    dayOfWeek: z
      .number({ error: 'Enter the day of the week, 1 to 7.' })
      .int('Enter the day of the week, 1 to 7.')
      .min(1, 'Enter the day of the week, 1 to 7.')
      .max(7, 'Enter the day of the week, 1 to 7.'),
    isWorkingDay: z.boolean({ error: 'Must be true or false.' }),
    startTime: hhmm.nullable(),
    endTime: hhmm.nullable(),
  })
  .superRefine((day, ctx) => {
    if (!day.isWorkingDay) {
      // A day off has no hours.
      for (const field of ['startTime', 'endTime'] as const) {
        if (day[field] !== null) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: 'A day off has no hours: use null.',
          });
        }
      }
      return;
    }
    for (const field of ['startTime', 'endTime'] as const) {
      if (day[field] === null) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'A working day needs a start and an end time.',
        });
      }
    }
    // Zero-padded HH:mm strings sort like the times they are, but only when
    // both are well formed (a malformed time already has its own message).
    if (
      day.startTime &&
      day.endTime &&
      HHMM.test(day.startTime) &&
      HHMM.test(day.endTime) &&
      day.endTime <= day.startTime
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'The end time must be after the start time.',
      });
    }
  });

// PUT /api/admin/availability replaces the whole week: seven days, one each.
export const putAvailabilitySchema = z.strictObject({
  days: z
    .array(workingDaySchema, {
      error: 'Send the whole week as a list of days.',
    })
    .length(7, 'Send exactly seven days, Monday to Sunday.')
    .superRefine((days, ctx) => {
      const seen = new Set<number>();
      days.forEach((day, index) => {
        if (seen.has(day.dayOfWeek)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'dayOfWeek'],
            message: 'Each day of the week must appear exactly once.',
          });
        }
        seen.add(day.dayOfWeek);
      });
    }),
});

// --- Blocked times (A-6, #35) --------------------------------------------

const utcInstant = (label: string) =>
  z
    .string({
      error: `Enter the ${label} as a UTC time such as 2026-11-05T22:00:00Z.`,
    })
    .pipe(
      z.iso.datetime({
        error: `Enter the ${label} as a UTC time such as 2026-11-05T22:00:00Z.`,
      }),
    )
    .transform((s) => new Date(s));

export const createBlockedTimeSchema = z
  .strictObject({
    startAt: utcInstant('start'),
    endAt: utcInstant('end'),
    reason: z
      .string({ error: 'The reason must be text.' })
      .trim()
      .max(500, 'The reason must be at most 500 characters.')
      .nullable()
      .default(null),
  })
  .superRefine((blocked, ctx) => {
    if (blocked.endAt <= blocked.startAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'The end must be after the start.',
      });
    }
  });

const calendarDay = z
  .string({ error: 'Enter a date such as 2026-11-03.' })
  .refine(isValidDate, 'Enter a date such as 2026-11-03.');

// GET /api/admin/blocked-times?from=&to=
export const blockedTimesQuerySchema = z.strictObject({
  from: calendarDay.optional(),
  to: calendarDay.optional(),
});

// --- The public availability query (docs/api.md 4.2) ---------------------

export const availabilityQuerySchema = z.strictObject({
  serviceId: z.guid({ error: 'Enter the service.' }),
  date: calendarDay,
  // Where the appointment will be (#115): travel time is blocked around an
  // appointment at the client's place, so the open times differ
  location: z
    .enum(['studio', 'client'], { error: 'Choose studio or client.' })
    .default('studio'),
});
