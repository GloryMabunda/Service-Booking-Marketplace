import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { AuthModule } from './auth/auth.module.js';
import { ServicesModule } from './services/services.module.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { StorageModule } from './storage/storage.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { AdminModule } from './admin/admin.module.js';

@Module({
  imports: [
    // Reads .env (real environment variables win) and stops startup if
    // validateEnv finds a problem (#20). Available everywhere as ConfigService.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    AuthModule,
    ServicesModule,
    AvailabilityModule,
    BookingsModule,
    PaymentsModule,
    StorageModule,
    NotificationsModule,
    SettingsModule,
    AdminModule,
  ],
})
export class AppModule {}
