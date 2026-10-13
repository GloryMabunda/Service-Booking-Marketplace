import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  RATE_LIMITER,
  RateLimitGuard,
  SlidingWindowLimiter,
} from './rate-limit.js';

// Makes @RateLimit({...}) work on any route. One limiter for the whole app.
@Global()
@Module({
  providers: [
    { provide: RATE_LIMITER, useFactory: () => new SlidingWindowLimiter() },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}
