import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { LoginRateLimiter } from './login-rate-limiter.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    // One limiter for the whole app, using the real clock.
    { provide: LoginRateLimiter, useFactory: () => new LoginRateLimiter() },
    // Runs before every route in the app (#27).
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
