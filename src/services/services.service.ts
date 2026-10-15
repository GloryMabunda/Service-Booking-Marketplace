import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { ApiException } from '../common/api-error.js';
import { percentOf } from '../common/money.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { isPgError, isRestrictViolation } from '../database/pg-errors.js';
import {
  type BookingWindow,
  bookingWindow,
} from '../settings/booking-window.js';
import { SettingsService } from '../settings/settings.service.js';
import { type TravelTerms, travelTerms } from '../travel/travel-terms.js';
import {
  type CreateServiceInput,
  type Service,
  toService,
  type UpdateServiceInput,
} from './service.schema.js';

// GET /api/services (docs/api.md 4.1).
export interface PublicServices {
  services: {
    id: string;
    name: string;
    description: string;
    price: string;
    durationMinutes: number;
    depositAmount: string;
    availableForTravel: boolean;
  }[];
  depositPercent: string;
  business: { name: string; email: string; phone: string | null };
  bookingWindow: BookingWindow;
  // The travel fee rules, or null while the owner hasn't set up travel
  travel: TravelTerms | null;
}

const NOT_FOUND = () =>
  new ApiException(404, 'NOT_FOUND', "That service doesn't exist.");

// Managing services (A-5, #30, docs/api.md 7.12). Editing a service never
// changes existing bookings: each booking keeps its own price and duration
// (BR-4).
@Injectable()
export class ServicesService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly settings: SettingsService,
  ) {}

  // Services with how many bookings each has, sorted by name ignoring capitals.
  async list(includeInactive: boolean): Promise<Service[]> {
    let query = this.withBookingCount();
    if (!includeInactive) query = query.where('services.is_active', '=', true);
    const rows = await query
      .orderBy(sql`lower(services.name)`)
      .orderBy('services.id')
      .execute();
    return rows.map((row) => toService(row, Number(row.booking_count)));
  }

  // What clients see (C-1, #32): active services only (BR-5), each with its
  // deposit (BR-7), plus the business details and the range of dates that can
  // be booked. An inactive service never appears; its existing bookings are
  // untouched (#33).
  async listPublic(now = new Date()): Promise<PublicServices> {
    const [rows, settings] = await Promise.all([
      this.db
        .selectFrom('services')
        .selectAll()
        .where('is_active', '=', true)
        .orderBy(sql`lower(name)`)
        .orderBy('id')
        .execute(),
      this.settings.get(),
    ]);
    return {
      services: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        price: row.price,
        durationMinutes: row.duration_minutes,
        depositAmount: percentOf(settings.depositPercent, row.price),
        availableForTravel: row.available_for_travel,
      })),
      travel: travelTerms(settings),
      depositPercent: settings.depositPercent,
      business: {
        name: settings.businessName,
        email: settings.businessEmail,
        phone: settings.businessPhone,
      },
      bookingWindow: bookingWindow(now, settings),
    };
  }

  async create(input: CreateServiceInput): Promise<Service> {
    try {
      const row = await this.db
        .insertInto('services')
        .values({
          name: input.name,
          description: input.description,
          price: input.price,
          duration_minutes: input.durationMinutes,
          is_active: input.isActive,
          available_for_travel: input.availableForTravel,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toService(row, 0);
    } catch (error) {
      throw this.translate(error);
    }
  }

  async update(id: string, patch: UpdateServiceInput): Promise<Service> {
    const set = {
      name: patch.name,
      description: patch.description,
      price: patch.price,
      duration_minutes: patch.durationMinutes,
      is_active: patch.isActive,
      available_for_travel: patch.availableForTravel,
    };
    const changes = Object.values(set).some((value) => value !== undefined);

    if (changes) {
      try {
        const updated = await this.db
          .updateTable('services')
          .set({ ...set, updated_at: new Date() })
          .where('id', '=', id)
          .returning('id')
          .executeTakeFirst();
        if (!updated) throw NOT_FOUND();
      } catch (error) {
        throw this.translate(error);
      }
    }
    return this.get(id);
  }

  // Deletes a service nobody has booked. A service with bookings can't be
  // deleted (the foreign key refuses, so old bookings keep their service), so
  // it is deactivated instead and the caller is told.
  async remove(
    id: string,
  ): Promise<{ deleted: true } | { deleted: false; service: Service }> {
    await this.get(id); // 404 if it doesn't exist
    try {
      await this.db.deleteFrom('services').where('id', '=', id).execute();
      return { deleted: true };
    } catch (error) {
      // Also covers a booking made a moment ago, between any check and here.
      if (!isRestrictViolation(error)) throw error;
    }
    await this.db
      .updateTable('services')
      .set({ is_active: false, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
    return { deleted: false, service: await this.get(id) };
  }

  // An active service (BR-5), or null if it doesn't exist or is inactive.
  // `id` must be a valid UUID; callers check that first.
  async findActive(id: string): Promise<{
    id: string;
    name: string;
    durationMinutes: number;
    availableForTravel: boolean;
  } | null> {
    const row = await this.db
      .selectFrom('services')
      .select(['id', 'name', 'duration_minutes', 'available_for_travel'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .executeTakeFirst();
    return row
      ? {
          id: row.id,
          name: row.name,
          durationMinutes: row.duration_minutes,
          availableForTravel: row.available_for_travel,
        }
      : null;
  }

  // The list price of a service, for working out a deposit
  async priceOf(id: string): Promise<string> {
    const row = await this.db
      .selectFrom('services')
      .select('price')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return row.price;
  }

  async get(id: string): Promise<Service> {
    const row = await this.withBookingCount()
      .where('services.id', '=', id)
      .executeTakeFirst();
    if (!row) throw NOT_FOUND();
    return toService(row, Number(row.booking_count));
  }

  private withBookingCount() {
    return this.db
      .selectFrom('services')
      .leftJoin('bookings', 'bookings.service_id', 'services.id')
      .selectAll('services')
      .select(({ fn }) => fn.count<string>('bookings.id').as('booking_count'))
      .groupBy('services.id');
  }

  // A name already used by another service becomes 409 SERVICE_NAME_TAKEN.
  private translate(error: unknown): unknown {
    if (isPgError(error, '23505', 'services_name_key')) {
      return new ApiException(
        409,
        'SERVICE_NAME_TAKEN',
        'Another service already has this name.',
      );
    }
    return error;
  }
}
