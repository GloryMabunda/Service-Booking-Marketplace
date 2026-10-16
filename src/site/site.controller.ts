import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/sessions.js';
import { ApiException, parseBody } from '../common/api-error.js';
import { receiveMultipart } from '../common/multipart.js';
import { RateLimit } from '../common/rate-limit.js';
import { GalleryService } from './gallery.service.js';
import { ImagesService } from './images.service.js';
import { MAX_PHOTO_BYTES } from './image-processing.js';
import { PublicSiteService } from './public-site.service.js';
import { SiteContentService } from './site-content.service.js';
import { FaqsService, TestimonialsService } from './site-lists.service.js';
import {
  createFaqSchema,
  createTestimonialSchema,
  galleryPatchSchema,
  galleryUploadFieldsSchema,
  imageSlotSchema,
  orderSchema,
  siteContentPatchSchema,
  updateFaqSchema,
  updateTestimonialSchema,
} from './site.schema.js';

// GET /api/site (C-9, docs/api.md 4.6): everything the home page needs in one
// call, public and cached for 60 seconds.
@Controller('site')
export class PublicSiteController {
  constructor(private readonly site: PublicSiteService) {}

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60 })
  get(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return this.site.get();
  }
}

// GET /api/brand (docs/api.md 4.11): the name, tagline and logo every page
// shows in its header and footer. Public and cached for 60 seconds.
@Controller('brand')
export class PublicBrandController {
  constructor(private readonly site: PublicSiteService) {}

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60 })
  get(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return this.site.brand();
  }
}

const slotOrFail = (slot: string) => {
  const parsed = imageSlotSchema.safeParse(slot);
  if (!parsed.success) {
    throw new ApiException(404, 'NOT_FOUND', 'There is no such photo slot.');
  }
  return parsed.data;
};

// /api/admin/site-content (A-10, docs/api.md 7.16): About, contact and area,
// and the hero and About photos. Like every /api/admin route it needs a
// signed-in admin (#27).
@Controller('admin/site-content')
export class AdminSiteContentController {
  constructor(
    private readonly content: SiteContentService,
    private readonly images: ImagesService,
  ) {}

  @Get()
  get(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.content.get();
  }

  @Patch()
  update(
    @Body() body: unknown,
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.content.update(
      parseBody(siteContentPatchSchema, body),
      user.id,
    );
  }

  @Put('images/:slot')
  async putImage(
    @Param('slot') slot: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: SessionUser,
  ) {
    const target = slotOrFail(slot);
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
    return this.content.setImage(target, files[0].buffer, user.id, altText);
  }

  @Delete('images/:slot')
  @HttpCode(204)
  async removeImage(
    @Param('slot') slot: string,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    await this.content.removeImage(slotOrFail(slot), user.id);
  }
}

// /api/admin/gallery (A-10, BR-16, docs/api.md 7.17)
@Controller('admin/gallery')
export class AdminGalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get()
  list(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.gallery.list();
  }

  // 1 to 10 photos in one request, each processed on its own
  @Post()
  @HttpCode(201)
  async upload(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: SessionUser,
  ) {
    const { files, fields } = await receiveMultipart(req, res, {
      field: 'files',
      maxFiles: 10,
      maxBytes: MAX_PHOTO_BYTES,
      maxFields: 2,
    });
    // The owner must confirm she may show these photos (A-10)
    if (fields.consent !== 'true') {
      throw new ApiException(
        400,
        'CONSENT_REQUIRED',
        'Please confirm you have the right to show these photos, and that anyone in them has agreed.',
      );
    }
    const { serviceId } = parseBody(galleryUploadFieldsSchema, {
      consent: fields.consent,
      ...(fields.serviceId ? { serviceId: fields.serviceId } : {}),
    });
    res.setHeader('Cache-Control', 'no-store');
    return this.gallery.upload(files, { serviceId, adminId: user.id });
  }

  // Declared before ':id' so "order" is never taken for an id
  @Put('order')
  reorder(@Body() body: unknown) {
    return this.gallery.reorder(parseBody(orderSchema, body).ids);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.gallery.update(id, parseBody(galleryPatchSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.gallery.remove(id);
  }
}

// /api/admin/testimonials (A-10, docs/api.md 7.18)
@Controller('admin/testimonials')
export class AdminTestimonialsController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Get()
  list() {
    return this.testimonials.list();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown) {
    return this.testimonials.create(parseBody(createTestimonialSchema, body));
  }

  @Put('order')
  reorder(@Body() body: unknown) {
    return this.testimonials.reorder(parseBody(orderSchema, body).ids);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.testimonials.update(
      id,
      parseBody(updateTestimonialSchema, body),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.testimonials.remove(id);
  }
}

// /api/admin/faqs (A-10, docs/api.md 7.18)
@Controller('admin/faqs')
export class AdminFaqsController {
  constructor(private readonly faqs: FaqsService) {}

  @Get()
  list() {
    return this.faqs.list();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown) {
    return this.faqs.create(parseBody(createFaqSchema, body));
  }

  @Put('order')
  reorder(@Body() body: unknown) {
    return this.faqs.reorder(parseBody(orderSchema, body).ids);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.faqs.update(id, parseBody(updateFaqSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.faqs.remove(id);
  }
}
