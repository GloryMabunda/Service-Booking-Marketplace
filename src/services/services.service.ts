import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { isPgError, isRestrictViolation } from '../database/pg-errors.js';
import {
  type CreateServiceInput,
  type Service,
  toService,
  type UpdateServiceInput,
} from './service.schema.js';

const NOT_FOUND = () =>
  new ApiException(404, 'NOT_FOUND', "That service doesn't exist.");

// Managing services (A-5, #30, docs/api.md 7.12). Editing a service never
// changes existing bookings: each booking keeps its own price and duration
// (BR-4).
@Injectable()
export class ServicesService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

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
