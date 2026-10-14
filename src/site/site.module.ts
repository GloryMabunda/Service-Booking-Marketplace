import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { GalleryService } from './gallery.service.js';
import { ImagesService } from './images.service.js';
import { MediaController } from './media.controller.js';
import { PublicSiteService } from './public-site.service.js';
import { SiteContentService } from './site-content.service.js';
import {
  AdminFaqsController,
  AdminGalleryController,
  AdminSiteContentController,
  AdminTestimonialsController,
  PublicSiteController,
} from './site.controller.js';
import { FaqsService, TestimonialsService } from './site-lists.service.js';

// The home page content (C-9, A-10, BR-16): the public site API, the photos
// and /media, and the owner's endpoints to manage them.
@Module({
  imports: [AvailabilityModule, SettingsModule],
  controllers: [
    PublicSiteController,
    MediaController,
    AdminSiteContentController,
    AdminGalleryController,
    AdminTestimonialsController,
    AdminFaqsController,
  ],
  providers: [
    ImagesService,
    SiteContentService,
    GalleryService,
    TestimonialsService,
    FaqsService,
    PublicSiteService,
  ],
  exports: [ImagesService],
})
export class SiteModule {}
