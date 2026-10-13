import { Module } from '@nestjs/common';
import { AdminServicesController } from './admin-services.controller.js';
import { ServicesService } from './services.service.js';

// Services the business offers (A-5, C-1). The public listing (#32) joins the
// admin API here.
@Module({
  controllers: [AdminServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
