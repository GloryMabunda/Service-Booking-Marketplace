import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { ServicesModule } from '../services/services.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { BOOKING_NOTIFIER, NoEmailNotifier } from './booking-notifier.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsRepository } from './bookings.repository.js';
import { BookingsService } from './bookings.service.js';

// Bookings (M4). The repository stores them; the service creates one (#45)
// with its link token (#47) and the limits (#48). Expiry (#50) and lookup
// (#52) build on it. M5 replaces the notifier with the real email sender.
@Module({
  imports: [AvailabilityModule, ServicesModule, SettingsModule],
  controllers: [BookingsController],
  providers: [
    BookingsRepository,
    BookingsService,
    { provide: BOOKING_NOTIFIER, useClass: NoEmailNotifier },
  ],
  exports: [BookingsRepository, BookingsService],
})
export class BookingsModule {}
