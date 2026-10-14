import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ApiExceptionFilter } from './common/api-error.js';
import { RateLimitModule } from './common/rate-limit.module.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ServicesModule } from './services/services.module.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { StorageModule } from './storage/storage.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SiteModule } from './site/site.module.js';
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
    // The public website: files in public/ at the site root (#23). This file
    // is src/app.module.ts or dist/app.module.js, so public/ is one level up.
    // renderPath '/' means only the home page falls back to index.html; an
    // unknown address is a 404, not the home page. /api stays with the API.
    ServeStaticModule.forRoot({
      rootPath: join(import.meta.dirname, '..', 'public'),
      renderPath: '/',
      exclude: ['/api/{*path}'],
    }),
    DatabaseModule,
    RateLimitModule,
    AuthModule,
    ServicesModule,
    AvailabilityModule,
    BookingsModule,
    PaymentsModule,
    StorageModule,
    NotificationsModule,
    SettingsModule,
    SiteModule,
    AdminModule,
  ],
  // Every error leaves the API in the shape from docs/api.md section 2.
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
