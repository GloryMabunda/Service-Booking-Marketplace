import type { Selectable } from 'kysely';
import { z } from 'zod';
import { isoUtc } from '../availability/time-zone.js';
import type { DB } from '../database/database.types.js';
import type { AdminImage } from '../site/images.service.js';

// A bookable service (A-5, #29) as the admin API returns it
// (docs/api.md 7.12). Money is a string with two decimals: "650.00".
export interface Service {
  id: string;
  name: string;
  description: string;
  price: string;
  durationMinutes: number;
  isActive: boolean;
  // Where it can be done: at the owner's place, at the client's place, or both
  availableAtOurPlace: boolean;
  availableForTravel: boolean;
  // The picture the owner uploaded for it, or null
  image: AdminImage | null;
  bookingCount: number;
  createdAt: string;
  updatedAt: string;
}

export function toService(
  row: Selectable<DB['services']>,
  bookingCount = 0,
  image: AdminImage | null = null,
): Service {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    durationMinutes: row.duration_minutes,
    isActive: row.is_active,
    availableAtOurPlace: row.available_at_our_place,
    availableForTravel: row.available_for_travel,
    image,
    bookingCount,
    createdAt: isoUtc(new Date(row.created_at)),
    updatedAt: isoUtc(new Date(row.updated_at)),
  };
}

// Field rules match the services table (docs/database.md 3.2), so valid
// input never fails a database constraint with a confusing error. The one
// rule only the database can check is the unique name: #30 turns that error
// into 409 SERVICE_NAME_TAKEN.
const fields = {
  name: z
    .string({ error: 'Enter the service name.' })
    .trim()
    .min(1, 'Enter the service name.')
    .max(100, 'The name must be at most 100 characters.'),
  description: z
    .string({ error: 'The description must be text.' })
    .trim()
    .max(2000, 'The description must be at most 2,000 characters.'),
  price: z
    .string({ error: 'Enter a price such as "650.00".' })
    .trim()
    // Up to 8 digits before the point, matching numeric(10,2).
    .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter a price such as "650.00".')
    .transform((s) => Number(s).toFixed(2)),
  durationMinutes: z
    .number({ error: 'Enter the duration in minutes.' })
    .int('Enter the duration in whole minutes.')
    .min(1, 'The duration must be between 1 and 720 minutes.')
    .max(720, 'The duration must be between 1 and 720 minutes.'),
  isActive: z.boolean({ error: 'Must be true or false.' }),
  availableAtOurPlace: z.boolean({ error: 'Must be true or false.' }),
  availableForTravel: z.boolean({ error: 'Must be true or false.' }),
};

export const NO_PLACE_MESSAGE =
  "Choose where it's done: at your place, at the client's place, or both.";

// POST /api/admin/services: name, price and duration are required.
export const createServiceSchema = z
  .strictObject({
    name: fields.name,
    description: fields.description.default(''),
    price: fields.price,
    durationMinutes: fields.durationMinutes,
    isActive: fields.isActive.default(true),
    availableAtOurPlace: fields.availableAtOurPlace.default(true),
    availableForTravel: fields.availableForTravel.default(false),
  })
  .refine((value) => value.availableAtOurPlace || value.availableForTravel, {
    path: ['availableAtOurPlace'],
    message: NO_PLACE_MESSAGE,
  });

// PATCH /api/admin/services/:id: any of the same fields.
export const updateServiceSchema = z.strictObject(fields).partial();

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
