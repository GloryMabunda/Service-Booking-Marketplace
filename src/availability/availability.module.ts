import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import {
  AdminAvailabilityController,
  AdminBlockedTimesController,
  PublicAvailabilityController,
} from './availability.controllers.js';
import { AvailabilityService } from './availability.service.js';
import { BlockedTimesService } from './blocked-times.service.js';

// Working hours, blocked times and the slots clients can book (M3). Bookings
// (M4) import this module to re-check a slot when a booking is submitted.
@Module({
  imports: [SettingsModule, ServicesModule],
  controllers: [
    PublicAvailabilityController,
    AdminAvailabilityController,
    AdminBlockedTimesController,
  ],
  providers: [AvailabilityService, BlockedTimesService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
