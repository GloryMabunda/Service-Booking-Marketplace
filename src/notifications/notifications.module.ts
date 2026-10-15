import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BOOKING_NOTIFIER } from '../bookings/booking-notifier.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DemoMailbox } from '../demo/demo-mailbox.js';
import { EmailBookingNotifier } from './email-booking-notifier.js';
import { EMAIL_PROVIDER, createEmailProvider } from './email-provider.js';
import { NotificationsService } from './notifications.service.js';

// Notifications (M5). The email provider is chosen from the environment
// (SMTP_HOST set: send through SMTP; empty: send nothing, record the failure).
// Bookings use the notifier below through the BOOKING_NOTIFIER interface.
@Module({
  imports: [SettingsModule],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useFactory: createEmailProvider,
      inject: [ConfigService, DemoMailbox],
    },
    DemoMailbox,
    NotificationsService,
    EmailBookingNotifier,
    { provide: BOOKING_NOTIFIER, useExisting: EmailBookingNotifier },
  ],
  exports: [BOOKING_NOTIFIER, NotificationsService, DemoMailbox],
})
export class NotificationsModule {}
