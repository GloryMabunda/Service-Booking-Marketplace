import { z } from 'zod';
import { isValidDate } from '../availability/time-zone.js';
import { formatCents, toCents } from '../common/money.js';
import { BOOKING_STATUSES } from './booking-status.js';

// Requests to /api/admin/bookings (docs/api.md section 7).

const calendarDay = z
  .string({ error: 'Enter a date such as 2026-11-03.' })
  .refine(isValidDate, 'Enter a date such as 2026-11-03.');

const utcInstant = z
  .string({ error: 'Enter a UTC time such as 2026-11-02T15:00:00Z.' })
  .pipe(
    z.iso.datetime({
      error: 'Enter a UTC time such as 2026-11-02T15:00:00Z.',
    }),
  )
  .transform((s) => new Date(s));

const statusList = z
  .string({ error: 'Use statuses such as pending,confirmed.' })
  .transform((s) => s.split(',').map((part) => part.trim()))
  .refine(
    (list) =>
      list.length > 0 &&
      list.every((item) =>
        (BOOKING_STATUSES as readonly string[]).includes(item),
      ),
    `Use statuses from: ${BOOKING_STATUSES.join(', ')}.`,
  )
  .transform((list) => list as (typeof BOOKING_STATUSES)[number][]);

const wholeNumber = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} must be a whole number.` })
    .regex(/^\d+$/, `${label} must be a whole number.`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${label} must be ${min} to ${max}.`);

// GET /api/admin/bookings
export const listBookingsQuerySchema = z.strictObject({
  status: statusList.optional(),
  from: calendarDay.optional(),
  to: calendarDay.optional(),
  proof: z.literal('received', { error: 'Use proof=received.' }).optional(),
  q: z
    .string()
    .trim()
    .max(100, 'The search must be at most 100 characters.')
    .optional(),
  sort: z
    .enum(['startAt', '-startAt', 'createdAt', '-createdAt'], {
      error: 'Sort by startAt or createdAt, with a - for newest first.',
    })
    .default('startAt'),
  page: wholeNumber('page', 1, 100_000).default(1),
  pageSize: wholeNumber('pageSize', 1, 100).default(25),
});
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

// POST /api/admin/bookings/:id/confirm-payment
export const confirmPaymentSchema = z.strictObject({
  amountReceived: z
    .string({ error: 'Enter the amount received, such as "325.00".' })
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter the amount received, such as "325.00".')
    // zod keeps checking after the pattern fails, so only read amounts that
    // passed it
    .refine(
      (s) => !/^\d+(\.\d{1,2})?$/.test(s) || toCents(s) > 0,
      'The amount received must be more than 0.',
    )
    .transform((s) => formatCents(toCents(s))),
});

// PATCH /api/admin/bookings/:id/deadline
export const extendDeadlineSchema = z.strictObject({
  depositDueAt: utcInstant,
});

// PATCH /api/admin/bookings/:id/status
export const changeStatusSchema = z.strictObject({
  status: z.enum(['cancelled', 'completed', 'no_show'], {
    error: 'Choose cancelled, completed or no_show.',
  }),
  refundDue: z
    .boolean({ error: 'refundDue must be true or false.' })
    .optional(),
});
