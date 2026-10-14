import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { SettingsService } from '../settings/settings.service.js';
import { isoUtc, localDate, localDayRange } from './time-zone.js';

export interface BlockedTime {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
  createdAt: string;
}

function toBlockedTime(row: Selectable<DB['blocked_times']>): BlockedTime {
  return {
    id: row.id,
    startAt: isoUtc(new Date(row.start_at)),
    endAt: isoUtc(new Date(row.end_at)),
    reason: row.reason,
    createdAt: isoUtc(new Date(row.created_at)),
  };
}

// Dates or time ranges the owner has blocked (A-6, #35, docs/api.md 7.14).
// A whole day is sent as midnight to midnight in the business time zone.
@Injectable()
export class BlockedTimesService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly settings: SettingsService,
  ) {}

  // Blocked times that end after the start of `from` (default: today) and, when
  // `to` is given, start before the end of that day. Both are calendar days in
  // the business time zone.
  async list(
    from?: string,
    to?: string,
    now = new Date(),
  ): Promise<BlockedTime[]> {
    const { timeZone } = await this.settings.get();
    const fromDay = from ?? localDate(now, timeZone);
    let query = this.db
      .selectFrom('blocked_times')
      .selectAll()
      .where('end_at', '>', localDayRange(fromDay, timeZone).start);
    if (to) {
      query = query.where('start_at', '<', localDayRange(to, timeZone).end);
    }
    const rows = await query.orderBy('start_at').orderBy('id').execute();
    return rows.map(toBlockedTime);
  }

  // Blocking time that has Pending or Confirmed bookings in it is allowed:
  // those bookings are not cancelled, but their references are returned so the
  // owner can decide what to do.
  async create(input: {
    startAt: Date;
    endAt: Date;
    reason: string | null;
  }): Promise<{ blockedTime: BlockedTime; overlappingBookings: string[] }> {
    const row = await this.db
      .insertInto('blocked_times')
      .values({
        start_at: input.startAt,
        end_at: input.endAt,
        reason: input.reason,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const overlapping = await this.db
      .selectFrom('bookings')
      .select('reference')
      .where('status', 'in', ['pending', 'confirmed'])
      .where('start_at', '<', input.endAt)
      .where('occupied_until', '>', input.startAt)
      .orderBy('start_at')
      .execute();

    return {
      blockedTime: toBlockedTime(row),
      overlappingBookings: overlapping.map((b) => b.reference),
    };
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db
      .deleteFrom('blocked_times')
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();
    if (!deleted) {
      throw new ApiException(
        404,
        'NOT_FOUND',
        "That blocked time doesn't exist.",
      );
    }
  }
}
