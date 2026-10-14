import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { isoUtc, localDayRange } from '../availability/time-zone.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { SettingsService } from '../settings/settings.service.js';

// The appointments and blocked times for the calendar (A-7, docs/api.md 7.11).
@Injectable()
export class AdminCalendarService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly settings: SettingsService,
  ) {}

  // Everything that overlaps the days from..to, both included, counted as
  // business-zone days. Cancelled and Expired bookings only on request.
  async get(from: string, to: string, includeCancelled: boolean) {
    const { timeZone } = await this.settings.get();
    const start = localDayRange(from, timeZone).start;
    const end = localDayRange(to, timeZone).end;

    const bookings = await this.db
      .selectFrom('bookings')
      .innerJoin('services', 'services.id', 'bookings.service_id')
      .select([
        'bookings.id',
        'bookings.reference',
        'bookings.client_name',
        'bookings.start_at',
        'bookings.end_at',
        'bookings.status',
        'services.name as service_name',
      ])
      .where('bookings.start_at', '<', end)
      .where('bookings.end_at', '>', start)
      .$if(!includeCancelled, (qb) =>
        qb.where('bookings.status', 'not in', ['cancelled', 'expired']),
      )
      .orderBy('bookings.start_at')
      .orderBy('bookings.id')
      .execute();

    const blocked = await this.db
      .selectFrom('blocked_times')
      .select(['id', 'start_at', 'end_at', 'reason'])
      .where('start_at', '<', end)
      .where('end_at', '>', start)
      .orderBy('start_at')
      .execute();

    return {
      timeZone,
      events: bookings.map((b) => ({
        id: b.id,
        reference: b.reference,
        title: `${b.service_name} · ${b.client_name}`,
        start: isoUtc(new Date(b.start_at)),
        end: isoUtc(new Date(b.end_at)),
        status: b.status,
      })),
      blockedTimes: blocked.map((t) => ({
        id: t.id,
        start: isoUtc(new Date(t.start_at)),
        end: isoUtc(new Date(t.end_at)),
        reason: t.reason,
      })),
    };
  }
}
