import { Module } from '@nestjs/common';
import { ImagesModule } from '../site/images.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminServicesController } from './admin-services.controller.js';
import { PublicServicesController } from './public-services.controller.js';
import { ServicesService } from './services.service.js';

// Services the business offers (A-5, C-1): the admin API (#30) and the public
// listing (#32).
@Module({
  imports: [ImagesModule, SettingsModule],
  controllers: [AdminServicesController, PublicServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
