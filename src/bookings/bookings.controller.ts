import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { parseBody } from '../common/api-error.js';
import { RateLimit } from '../common/rate-limit.js';
import { createBookingSchema } from './booking.schema.js';
import { BookingsService } from './bookings.service.js';

// POST /api/bookings (C-3, docs/api.md 4.3): public, no sign-in. Limited to
// 10 requests an hour per IP address (section 3), on top of the limit of 2
// Pending bookings per email or phone (BR-11) checked in the service.
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

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
}
