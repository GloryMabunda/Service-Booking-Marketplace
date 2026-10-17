import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import {
  RATE_LIMITER,
  RateLimitedException,
  type SlidingWindowLimiter,
} from '../common/rate-limit.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { BOOKING_NOTIFIER, type BookingNotifier } from './booking-notifier.js';
import { generateBookingToken, hashBookingToken } from './booking-token.js';
import { sameEmail } from './booking-lookup.service.js';
import { BookingsRepository } from './bookings.repository.js';

const REFERENCE = /^BK-\d{6,}$/;

// 3 new links an hour for one booking, however many addresses ask (docs/api.md
// section 3). The count is by the reference typed, whether or not it exists,
// so hitting the limit tells nobody anything.
const PER_BOOKING = { limit: 3, windowMs: 3_600_000 };

// At most this many bookings are sent when someone asks by email alone
const MOST_BY_EMAIL = 5;

// Issues a new booking link on request (C-6, BR-15, #58). The old link stops
// working the moment the new one is made, and the new one is emailed to the
// booking's own address and nowhere else.
@Injectable()
export class BookingLinkService {
  private readonly logger = new Logger(BookingLinkService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly bookings: BookingsRepository,
    @Inject(BOOKING_NOTIFIER) private readonly notifier: BookingNotifier,
    @Inject(RATE_LIMITER) private readonly limiter: SlidingWindowLimiter,
  ) {}

  // Always finishes the same way, whether or not the reference and email
  // matched an active booking, and does not wait for the email, so neither the
  // answer nor its timing shows which bookings exist.
  async resend(
    reference: string,
    email: string,
    now = new Date(),
  ): Promise<void> {
    const ref = reference.trim().toUpperCase();
    const result = this.limiter.consume(
      `resend-link|${ref}`,
      PER_BOOKING.limit,
      PER_BOOKING.windowMs,
    );
    if (!result.allowed) {
      throw new RateLimitedException(result.resetSeconds, result.limit);
    }

    const row = REFERENCE.test(ref)
      ? await this.db
          .selectFrom('bookings')
          .select(['id', 'client_email'])
          .where('reference', '=', ref)
          .executeTakeFirst()
      : undefined;
    // Compared the same way whether or not a booking was found
    const matches = sameEmail(email, row?.client_email ?? '');
    if (!row || !matches) return;

    const token = generateBookingToken();
    const booking = await this.bookings.reissueLink(
      row.id,
      hashBookingToken(token),
      now,
    );
    if (!booking) return; // not Pending or Confirmed, or already started

    this.send(booking, token);
  }

  // For someone who knows only their reference or only their email: a new
  // link for each active booking found goes to that booking's own address,
  // and nothing about what was found is shown. Always finishes the same way.
  async sendLinks(
    input: { reference?: string; email?: string },
    now = new Date(),
  ): Promise<void> {
    const ref = input.reference?.trim().toUpperCase() ?? '';
    const email = input.email?.trim().toLowerCase() ?? '';
    // Counted by what was typed, whether or not it matches anything
    const result = this.limiter.consume(
      `find-links|${ref || email}`,
      PER_BOOKING.limit,
      PER_BOOKING.windowMs,
    );
    if (!result.allowed) {
      throw new RateLimitedException(result.resetSeconds, result.limit);
    }

    let ids: string[] = [];
    if (ref) {
      if (REFERENCE.test(ref)) {
        const row = await this.db
          .selectFrom('bookings')
          .select(['id', 'client_email'])
          .where('reference', '=', ref)
          .executeTakeFirst();
        // With both given, they must match, as everywhere else
        if (row && (!email || sameEmail(email, row.client_email))) {
          ids = [row.id];
        }
      }
    } else {
      const rows = await this.db
        .selectFrom('bookings')
        .select('id')
        .where(sql<string>`lower(client_email)`, '=', email)
        .where('status', 'in', ['pending', 'confirmed'])
        .where('start_at', '>', now)
        .orderBy('start_at')
        .limit(MOST_BY_EMAIL)
        .execute();
      ids = rows.map((row) => row.id);
    }

    for (const id of ids) {
      const token = generateBookingToken();
      const booking = await this.bookings.reissueLink(
        id,
        hashBookingToken(token),
        now,
      );
      if (booking) this.send(booking, token);
    }
  }

  private send(
    booking: Parameters<BookingNotifier['bookingLinkReissued']>[0],
    token: string,
  ): void {
    void this.notifier.bookingLinkReissued(booking, token).catch((error) => {
      // Log the reference and the reason, never the token
      this.logger.error(
        `The new link for ${booking.reference} could not be sent: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
