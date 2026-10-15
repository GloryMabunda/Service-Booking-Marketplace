import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ServicesModule } from '../services/services.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { TravelModule } from '../travel/travel.module.js';
import {
  AdminCalendarController,
  AdminProofsController,
} from './admin-proofs.controller.js';
import { AdminCalendarService } from './admin-calendar.service.js';
import { AdminProofsService } from './admin-proofs.service.js';
import { ProofRetentionService } from './proof-retention.service.js';
import {
  AdminBookingsController,
  AdminDashboardController,
} from './admin-bookings.controller.js';
import { AdminBookingsService } from './admin-bookings.service.js';
import { BookingExpiryService } from './booking-expiry.service.js';
import { BookingLinkGuard } from './booking-link.guard.js';
import { BookingLinkService } from './booking-link.service.js';
import { BookingLookupService } from './booking-lookup.service.js';
import { PublicBookingController } from './public-booking.controller.js';
import { PublicBookingService } from './public-booking.service.js';
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
    PaymentsModule,
    ServicesModule,
    SettingsModule,
    TravelModule,
  ],
  controllers: [
    BookingsController,
    PublicBookingController,
    AdminDashboardController,
    AdminBookingsController,
    AdminProofsController,
    AdminCalendarController,
  ],
  providers: [
    BookingsRepository,
    BookingsService,
    BookingLookupService,
    BookingLinkService,
    AdminBookingsService,
    AdminProofsService,
    AdminCalendarService,
    ProofRetentionService,
    BookingLinkGuard,
    PublicBookingService,
    BookingExpiryService,
  ],
  exports: [
    BookingsRepository,
    BookingsService,
    BookingExpiryService,
    ProofRetentionService,
  ],
})
export class BookingsModule {}
