import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ServicesModule } from '../services/services.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { BookingExpiryService } from './booking-expiry.service.js';
import { BookingLinkService } from './booking-link.service.js';
import { BookingLookupService } from './booking-lookup.service.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsRepository } from './bookings.repository.js';
import { BookingsService } from './bookings.service.js';

// Bookings (M4). The repository stores them; the service creates one (#45)
// with its link token (#47) and the limits (#48). Expiry (#50) and lookup
// (#52) build on it. The email sender comes from NotificationsModule (M5).
@Module({
  imports: [
    AvailabilityModule,
    NotificationsModule,
    ServicesModule,
    SettingsModule,
  ],
  controllers: [BookingsController],
  providers: [
    BookingsRepository,
    BookingsService,
    BookingLookupService,
    BookingLinkService,
    BookingExpiryService,
  ],
  exports: [BookingsRepository, BookingsService, BookingExpiryService],
})
export class BookingsModule {}
