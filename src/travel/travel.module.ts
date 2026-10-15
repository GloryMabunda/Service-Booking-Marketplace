import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServicesModule } from '../services/services.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import {
  createDistanceProvider,
  DISTANCE_PROVIDER,
} from './distance-provider.js';
import { TravelController } from './travel.controller.js';
import { TravelService } from './travel.service.js';

// Travel to clients (#115). The maps provider is chosen from the environment
// (OPENROUTESERVICE_API_KEY set: OpenRouteService; empty: travel bookings say
// they are unavailable).
@Module({
  imports: [ServicesModule, SettingsModule],
  controllers: [TravelController],
  providers: [
    {
      provide: DISTANCE_PROVIDER,
      useFactory: createDistanceProvider,
      inject: [ConfigService],
    },
    TravelService,
  ],
  exports: [TravelService],
})
export class TravelModule {}
