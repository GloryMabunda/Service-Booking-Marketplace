import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiException, parseBody } from '../common/api-error.js';
import { createServiceSchema, updateServiceSchema } from './service.schema.js';
import { ServicesService } from './services.service.js';

// /api/admin/services (A-5, docs/api.md 7.12). Under /api/admin, so the guard
// requires a signed-in admin (#27).

const includeInactiveSchema = z
  .enum(['true', 'false'], { error: 'Must be true or false.' })
  .optional();

// An id that isn't a UUID can't match any service: 404, like an unknown id.
const idSchema = z.guid();
function serviceId(raw: string): string {
  if (!idSchema.safeParse(raw).success) {
    throw new ApiException(404, 'NOT_FOUND', "That service doesn't exist.");
  }
  return raw;
}

@Controller('admin/services')
export class AdminServicesController {
  constructor(private readonly services: ServicesService) {}

  // The portal lists inactive services too, unless includeInactive=false.
  @Get()
  async list(@Query('includeInactive') includeInactive?: string) {
    const parsed = includeInactiveSchema.safeParse(includeInactive);
    if (!parsed.success) {
      throw new ApiException(
        400,
        'VALIDATION_FAILED',
        'Some details are missing or invalid.',
        [{ field: 'includeInactive', message: 'Must be true or false.' }],
      );
    }
    return { services: await this.services.list(parsed.data !== 'false') };
  }

  @Post()
  async create(@Body() body: unknown) {
    const input = parseBody(createServiceSchema, body);
    return { service: await this.services.create(input) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const patch = parseBody(updateServiceSchema, body);
    return { service: await this.services.update(serviceId(id), patch) };
  }

  // 204 when deleted; 200 with deactivated: true when bookings exist.
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.services.remove(serviceId(id));
    if (result.deleted) {
      res.status(204);
      return;
    }
    return { service: result.service, deactivated: true };
  }
}
