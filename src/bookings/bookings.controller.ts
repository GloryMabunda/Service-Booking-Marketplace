import { Body, Controller, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { parseBody } from '../common/api-error.js';
import { RateLimit } from '../common/rate-limit.js';
import { BookingLinkService } from './booking-link.service.js';
import { BookingLookupService } from './booking-lookup.service.js';
import {
  createBookingSchema,
  findLinksSchema,
  lookupBookingSchema,
} from './booking.schema.js';
import { BookingsService } from './bookings.service.js';

// POST /api/bookings (C-3, docs/api.md 4.3): public, no sign-in. Limited to
// 10 requests an hour per IP address (section 3), on top of the limit of 2
// Pending bookings per email or phone (BR-11) checked in the service.
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly lookups: BookingLookupService,
    private readonly links: BookingLinkService,
  ) {}

  @Post()
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseBody(createBookingSchema, body);
    // Personal details: never cached
    res.setHeader('Cache-Control', 'no-store');
    return this.bookings.create(input);
  }

  // POST /api/bookings/:reference/lookup (C-6, docs/api.md 4.4): a client
  // views their booking with its reference and email. A POST, so the email is
  // in the body. Limited to 10 requests per 15 minutes per IP address.
  @Post(':reference/lookup')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 900 })
  async lookup(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email } = parseBody(lookupBookingSchema, body);
    res.setHeader('Cache-Control', 'no-store');
    return this.lookups.lookup(reference, email);
  }

  // POST /api/bookings/find-links (C-6, docs/api.md 4.10): for a client who
  // knows only their reference or only their email. A new private link is
  // emailed to each active booking's own address; the answer never says what
  // was found. 10 an hour per IP, 3 an hour for what was typed.
  @Post('find-links')
  @HttpCode(202)
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  async findLinks(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseBody(findLinksSchema, body);
    res.setHeader('Cache-Control', 'no-store');
    await this.links.sendLinks(input);
    return {
      message:
        'If we found an active booking, a new booking link has been sent to the email address it was made with.',
    };
  }

  // POST /api/bookings/:reference/resend-booking-link (C-6, BR-15, docs/api.md
  // 4.5): emails a new private link to the booking's own address. The answer
  // is the same whether or not the details matched, so it can't be used to
  // find out which bookings exist. 10 an hour per IP, 3 an hour per booking.
  @Post(':reference/resend-booking-link')
  @HttpCode(202)
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  async resend(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email } = parseBody(lookupBookingSchema, body);
    res.setHeader('Cache-Control', 'no-store');
    await this.links.resend(reference, email);
    return {
      message:
        'If the details match an active booking, a new booking link has been sent to its email address.',
    };
  }
}
