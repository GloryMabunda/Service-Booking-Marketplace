import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Kysely, Selectable } from 'kysely';
import { ApiException } from '../common/api-error.js';
import {
  RATE_LIMITER,
  RateLimitedException,
  type RateLimitOptions,
  type SlidingWindowLimiter,
} from '../common/rate-limit.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { hashBookingToken } from './booking-token.js';

// Protects every /api/booking/:token route (BR-15, docs/api.md section 5).
//
// It hashes the token from the link, finds the booking and checks the link is
// active: Pending or Confirmed, and the appointment hasn't started. For a link
// that doesn't exist, that was replaced, or that is no longer active, the
// answer is always the same 404, so links can't be probed.
//
// It runs before anything is read from the request body, so an upload is
// refused before a single byte is streamed. Every response, including errors,
// carries Referrer-Policy: no-referrer and Cache-Control: no-store.

export type LinkedBooking = Selectable<DB['bookings']>;
export interface LinkedRequest extends Request {
  booking?: LinkedBooking;
}

export const linkNotValid = () =>
  new ApiException(
    404,
    'LINK_NOT_VALID',
    "This booking link isn't valid any more. If you need a new one, you can request it on the Find my booking page.",
  );

// A booking link is 43 characters of base64url (32 random bytes)
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const PER_BOOKING = 'booking-link:per-booking-limit';

// An extra limit counted for the one booking the link belongs to, on top of
// the limit per IP address (docs/api.md section 3)
export const PerBookingLimit = (options: RateLimitOptions) =>
  SetMetadata(PER_BOOKING, options);

@Injectable()
export class BookingLinkGuard implements CanActivate {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: SlidingWindowLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<LinkedRequest>();
    const res = http.getResponse<Response>();
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');

    const token = String(req.params.token ?? '');
    const booking = TOKEN_SHAPE.test(token)
      ? await this.db
          .selectFrom('bookings')
          .selectAll()
          .where('booking_token_hash', '=', hashBookingToken(token))
          .executeTakeFirst()
      : undefined;
    if (
      !booking ||
      (booking.status !== 'pending' && booking.status !== 'confirmed') ||
      new Date(booking.start_at) <= new Date()
    ) {
      throw linkNotValid();
    }

    const options = this.reflector.get<RateLimitOptions | undefined>(
      PER_BOOKING,
      context.getHandler(),
    );
    if (options) {
      const result = this.limiter.consume(
        `${context.getClass().name}.${context.getHandler().name}|booking:${booking.id}`,
        options.limit,
        options.windowSeconds * 1000,
      );
      if (!result.allowed) {
        throw new RateLimitedException(result.resetSeconds, result.limit);
      }
    }

    req.booking = booking;
    return true;
  }
}
