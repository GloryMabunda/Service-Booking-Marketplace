import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { GalleryService } from './gallery.service.js';
import { ImagesModule } from './images.module.js';
import { MediaController } from './media.controller.js';
import { PublicSiteService } from './public-site.service.js';
import { SiteContentService } from './site-content.service.js';
import {
  AdminFaqsController,
  AdminGalleryController,
  AdminSiteContentController,
  AdminTestimonialsController,
  PublicBrandController,
  PublicSiteController,
} from './site.controller.js';
import { FaqsService, TestimonialsService } from './site-lists.service.js';

// The home page content (C-9, A-10, BR-16): the public site API, the photos
// and /media, and the owner's endpoints to manage them.
@Module({
  imports: [AvailabilityModule, ImagesModule, SettingsModule],
  controllers: [
    PublicSiteController,
    PublicBrandController,
    MediaController,
    AdminSiteContentController,
    AdminGalleryController,
    AdminTestimonialsController,
    AdminFaqsController,
  ],
  providers: [
    SiteContentService,
    GalleryService,
    TestimonialsService,
    FaqsService,
    PublicSiteService,
  ],
})
export class SiteModule {}
