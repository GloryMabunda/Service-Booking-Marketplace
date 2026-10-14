import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
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

    void this.notifier.bookingLinkReissued(booking, token).catch((error) => {
      // Log the reference and the reason, never the token
      this.logger.error(
        `The new link for ${booking.reference} could not be sent: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
