import { z } from 'zod';
import { normalizeSouthAfricanPhone } from '../common/phone.js';

// POST /api/bookings (docs/api.md 4.3, C-3, C-4). The client's details are
// tidied as they are read: the email is lower-cased so the same address can't
// be written two ways, and the phone becomes E.164 ("+27821234567") so the
// booking limit (BR-11) can't be dodged by formatting.
export const createBookingSchema = z.strictObject({
  serviceId: z.guid({ error: 'Choose a service.' }),
  startAt: z
    .string({ error: 'Choose a date and time.' })
    .pipe(z.iso.datetime({ error: 'Choose a date and time.' }))
    .transform((s) => new Date(s)),
  clientName: z
    .string({ error: 'Enter your name.' })
    .trim()
    .min(1, 'Enter your name.')
    .max(100, 'The name must be at most 100 characters.'),
  clientEmail: z
    .string({ error: 'Enter a valid email address.' })
    .trim()
    .max(254, 'Enter a valid email address.')
    .toLowerCase()
    .pipe(z.email('Enter a valid email address.')),
  clientPhone: z
    .string({ error: 'Enter a South African phone number.' })
    .transform((s, ctx) => {
      const phone = normalizeSouthAfricanPhone(s);
      if (!phone) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a South African phone number.',
        });
        return z.NEVER;
      }
      return phone;
    }),
  notes: z
    .string({ error: 'The notes must be text.' })
    .trim()
    .max(1000, 'The notes must be at most 1,000 characters.')
    .nullish()
    .transform((s) => (s ? s : null)),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// POST /api/bookings/:reference/lookup (docs/api.md 4.4, C-6): the email travels
// in the body, never in the URL.
export const lookupBookingSchema = z.strictObject({
  email: z
    .string({ error: 'Enter the email you used to book.' })
    .trim()
    .max(254, 'Enter a valid email address.')
    .toLowerCase()
    .pipe(z.email('Enter a valid email address.')),
});
