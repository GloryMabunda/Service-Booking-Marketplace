import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ApiException } from './api-error.js';

// Rate limits (docs/api.md section 3): at most `limit` requests per client IP
// address in any `windowSeconds`, counted in memory (right for v1's single app
// instance; a restart forgets the counts).
//
//   @Get() @RateLimit({ limit: 60, windowSeconds: 60 })
//   list() { ... }
//
// Over the limit the API answers 429 RATE_LIMITED with Retry-After. Every
// response from a limited route carries RateLimit-Limit, -Remaining and -Reset.

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  // Seconds until the oldest counted request leaves the window
  resetSeconds: number;
}

// Sliding window: a request counts for `windowMs` after it was made.
export class SlidingWindowLimiter {
  private readonly entries = new Map<
    string,
    { times: number[]; windowMs: number }
  >();
  private calls = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  // Records a request for `key` if it is allowed.
  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = this.clock();
    if (++this.calls % 1000 === 0) this.dropExpired(now);

    const entry = this.entries.get(key) ?? { times: [], windowMs };
    entry.windowMs = windowMs;
    entry.times = entry.times.filter((t) => t > now - windowMs);
    this.entries.set(key, entry);

    if (entry.times.length >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds: Math.ceil((entry.times[0] + windowMs - now) / 1000),
      };
    }
    entry.times.push(now);
    return {
      allowed: true,
      limit,
      remaining: limit - entry.times.length,
      resetSeconds: Math.ceil((entry.times[0] + windowMs - now) / 1000),
    };
  }

  // Number of keys being tracked (for tests)
  size(): number {
    return this.entries.size;
  }

  private dropExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.times.every((t) => t <= now - entry.windowMs)) {
        this.entries.delete(key);
      }
    }
  }
}

export class RateLimitedException extends ApiException {
  constructor(
    readonly retryAfterSeconds: number,
    readonly limit: number,
    message = 'Too many requests. Please wait and try again.',
  ) {
    super(429, 'RATE_LIMITED', message, null, {
      'Retry-After': String(retryAfterSeconds),
      'RateLimit-Limit': String(limit),
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(retryAfterSeconds),
    });
  }
}

export const RATE_LIMITER = Symbol('RATE_LIMITER');
const RATE_LIMIT = 'rate-limit';

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: SlidingWindowLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT,
      context.getHandler(),
    );
    if (!options) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    // One counter per route and client IP address.
    const key = `${context.getClass().name}.${context.getHandler().name}|${req.ip ?? 'unknown'}`;

    const result = this.limiter.consume(
      key,
      options.limit,
      options.windowSeconds * 1000,
    );
    if (!result.allowed) {
      throw new RateLimitedException(result.resetSeconds, result.limit);
    }
    res.setHeader('RateLimit-Limit', String(result.limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    res.setHeader('RateLimit-Reset', String(result.resetSeconds));
    return true;
  }
}
