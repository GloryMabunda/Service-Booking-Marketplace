import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  HttpCode,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/sessions.js';
import { ApiException, parseBody } from '../common/api-error.js';
import { receiveMultipart } from '../common/multipart.js';
import { MAX_PHOTO_BYTES } from '../site/image-processing.js';
import { ImagesService } from '../site/images.service.js';
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
  constructor(
    private readonly services: ServicesService,
    private readonly images: ImagesService,
  ) {}

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

  // The picture clients see on the service's card (docs/api.md 7.12). One
  // photo, `multipart/form-data`, field `file`, optional text field `altText`.
  @Put(':id/image')
  async putImage(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: SessionUser,
  ) {
    const target = serviceId(id);
    this.images.charge(user.id, 1);
    const { files, fields } = await receiveMultipart(req, res, {
      field: 'file',
      maxFiles: 1,
      maxBytes: MAX_PHOTO_BYTES,
      maxFields: 1,
    });
    if (files.length === 0) {
      throw new ApiException(
        400,
        'FILE_MISSING',
        'Please choose a photo to upload.',
      );
    }
    const altText = fields.altText?.trim().slice(0, 250) || null;
    res.setHeader('Cache-Control', 'no-store');
    return {
      service: await this.services.setImage(
        target,
        files[0].buffer,
        user.id,
        altText,
      ),
    };
  }

  @Delete(':id/image')
  @HttpCode(204)
  async removeImage(@Param('id') id: string): Promise<void> {
    await this.services.removeImage(serviceId(id));
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
