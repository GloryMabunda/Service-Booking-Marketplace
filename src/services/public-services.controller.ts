import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ServicesService } from './services.service.js';

// GET /api/services (C-1, docs/api.md 4.1): public, no sign-in. The pages that
// start a booking load it first.
@Controller('services')
export class PublicServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  async list(@Res({ passthrough: true }) res: Response) {
    // May be cached for 60 seconds, so the booking window can be a minute old;
    // POST /api/bookings checks it again (#45).
    res.setHeader('Cache-Control', 'public, max-age=60');
    return this.services.listPublic();
  }
}
