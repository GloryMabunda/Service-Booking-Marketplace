import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiException, parseBody } from '../common/api-error.js';
import { RateLimit } from '../common/rate-limit.js';
import {
  availabilityQuerySchema,
  blockedTimesQuerySchema,
  createBlockedTimeSchema,
  putAvailabilitySchema,
} from './availability.schema.js';
import { AvailabilityService } from './availability.service.js';
import { BlockedTimesService } from './blocked-times.service.js';

// GET /api/availability (C-2, docs/api.md 4.2): public, 60 requests a minute
// per IP address. Never cached: slots change as bookings are made.
@Controller('availability')
export class PublicAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @RateLimit({ limit: 60, windowSeconds: 60 })
  async slots(
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { serviceId, date } = parseBody(availabilityQuerySchema, query);
    res.setHeader('Cache-Control', 'no-store');
    return this.availability.slotsFor(serviceId, date);
  }
}

// /api/admin/availability (A-6, docs/api.md 7.13): the guard for /api/admin
// requires a signed-in admin (#27).
@Controller('admin/availability')
export class AdminAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  get() {
    return this.availability.getWeek();
  }

  @Put()
  async put(@Body() body: unknown) {
    const { days } = parseBody(putAvailabilitySchema, body);
    return this.availability.setWeek(days);
  }
}

// An id that isn't a UUID can't match a blocked time: 404, like an unknown id.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// /api/admin/blocked-times (A-6, docs/api.md 7.14)
@Controller('admin/blocked-times')
export class AdminBlockedTimesController {
  constructor(private readonly blocked: BlockedTimesService) {}

  @Get()
  async list(@Query() query: unknown) {
    const { from, to } = parseBody(blockedTimesQuerySchema, query);
    return { blockedTimes: await this.blocked.list(from, to) };
  }

  @Post()
  async create(@Body() body: unknown) {
    return this.blocked.create(parseBody(createBlockedTimeSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    if (!GUID.test(id)) {
      throw new ApiException(
        404,
        'NOT_FOUND',
        "That blocked time doesn't exist.",
      );
    }
    await this.blocked.remove(id);
  }
}
