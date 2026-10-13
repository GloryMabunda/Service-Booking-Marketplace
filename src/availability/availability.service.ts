import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { ServicesService } from '../services/services.service.js';
import { bookingWindowBounds } from '../settings/booking-window.js';
import { SettingsService } from '../settings/settings.service.js';
import type { WorkingDay } from './availability.schema.js';
import { calculateSlots, type Interval } from './slots.js';
import { isoDayOfWeek, isoUtc, localDate, localDayRange } from './time-zone.js';

export interface AvailableSlots {
  serviceId: string;
  date: string;
  timeZone: string;
  slots: { startAt: string; endAt: string; localTime: string }[];
}

const MINUTE_MS = 60_000;

// Working hours (A-6, #34) and the slots clients can book (C-2, #37-#39).
@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly settings: SettingsService,
    private readonly services: ServicesService,
  ) {}

  // --- Working hours ------------------------------------------------------

  async getWeek(): Promise<{ timeZone: string; days: WorkingDay[] }> {
    const [{ timeZone }, days] = await Promise.all([
      this.settings.get(),
      this.workingDays(),
    ]);
    return { timeZone, days };
  }

  // Replaces the whole week. Existing bookings are not affected; only the
  // slots offered from now on change.
  async setWeek(
    days: WorkingDay[],
  ): Promise<{ timeZone: string; days: WorkingDay[] }> {
    await this.db.transaction().execute(async (trx) => {
      for (const day of days) {
        await trx
          .updateTable('availability')
          .set({
            is_working_day: day.isWorkingDay,
            start_time: day.startTime,
            end_time: day.endTime,
            updated_at: new Date(),
          })
          .where('day_of_week', '=', day.dayOfWeek)
          .execute();
      }
    });
    return this.getWeek();
  }

  private async workingDays(): Promise<WorkingDay[]> {
    const rows = await this.db
      .selectFrom('availability')
      .selectAll()
      .orderBy('day_of_week')
      .execute();
    return rows.map((row) => ({
      dayOfWeek: row.day_of_week,
      isWorkingDay: row.is_working_day,
      // The database returns "09:00:00"; the API speaks "09:00".
      startTime: row.start_time?.slice(0, 5) ?? null,
      endTime: row.end_time?.slice(0, 5) ?? null,
    }));
  }

  // --- Slots --------------------------------------------------------------

  // The start times open for a service on a calendar day in the business time
  // zone (docs/api.md 4.2). `now` is a parameter so tests can fix the clock.
  async slotsFor(
    serviceId: string,
    date: string,
    now = new Date(),
  ): Promise<AvailableSlots> {
    const service = await this.services.findActive(serviceId);
    if (!service) {
      throw new ApiException(
        400,
        'SERVICE_UNAVAILABLE',
        "That service isn't available.",
      );
    }
    const settings = await this.settings.get();
    const week = await this.workingDays();
    const day = week.find((d) => d.dayOfWeek === isoDayOfWeek(date));
    const hours =
      day?.isWorkingDay && day.startTime && day.endTime
        ? { start: day.startTime, end: day.endTime }
        : null;

    const { earliest, latest } = bookingWindowBounds(now, settings);
    const slots = hours
      ? calculateSlots({
          date,
          timeZone: settings.timeZone,
          hours,
          durationMinutes: service.durationMinutes,
          slotIntervalMinutes: settings.slotIntervalMinutes,
          bufferMinutes: settings.bufferMinutes,
          busy: await this.busyAround(date, settings),
          earliestStart: earliest,
          latestStart: latest,
        })
      : [];

    return {
      serviceId: service.id,
      date,
      timeZone: settings.timeZone,
      slots: slots.map((slot) => ({
        startAt: isoUtc(slot.startAt),
        endAt: isoUtc(slot.endAt),
        localTime: slot.localTime,
      })),
    };
  }

  // Is this exact start time still offered? Booking creation (#45) calls this
  // so the rules are re-checked at submission with the same code that offered
  // the slot: working hours, interval, bookings, blocked time, notice, the
  // advance window and the payment window.
  async isSlotOpen(
    serviceId: string,
    startAt: Date,
    now = new Date(),
  ): Promise<boolean> {
    const { timeZone } = await this.settings.get();
    const { slots } = await this.slotsFor(
      serviceId,
      localDate(startAt, timeZone),
      now,
    );
    return slots.some((slot) => slot.startAt === isoUtc(startAt));
  }

  // Everything that already occupies time near this day: Pending and
  // Confirmed bookings (start to occupied_until, buffer included) and blocked
  // times. Reaches a buffer past the day's end, because a slot's own buffer
  // may run past it.
  private async busyAround(
    date: string,
    settings: { timeZone: string; bufferMinutes: number },
  ): Promise<Interval[]> {
    const { start, end } = localDayRange(date, settings.timeZone);
    const reachEnd = new Date(
      end.getTime() + settings.bufferMinutes * MINUTE_MS,
    );

    const [bookings, blocked] = await Promise.all([
      this.db
        .selectFrom('bookings')
        .select(['start_at', 'occupied_until'])
        .where('status', 'in', ['pending', 'confirmed'])
        .where('start_at', '<', reachEnd)
        .where('occupied_until', '>', start)
        .execute(),
      this.db
        .selectFrom('blocked_times')
        .select(['start_at', 'end_at'])
        .where('start_at', '<', reachEnd)
        .where('end_at', '>', start)
        .execute(),
    ]);
    return [
      ...bookings.map((b) => ({
        start: new Date(b.start_at),
        end: new Date(b.occupied_until),
      })),
      ...blocked.map((b) => ({
        start: new Date(b.start_at),
        end: new Date(b.end_at),
      })),
    ];
  }
}
