import { RateLimitedException, SlidingWindowLimiter } from './rate-limit.js';

describe('SlidingWindowLimiter', () => {
  const SECOND = 1000;
  let now: number;
  let limiter: SlidingWindowLimiter;

  beforeEach(() => {
    now = Date.UTC(2026, 10, 3, 8, 0, 0);
    limiter = new SlidingWindowLimiter(() => now);
  });

  it('allows requests up to the limit and says how many are left', () => {
    expect(limiter.consume('a', 3, 60 * SECOND)).toMatchObject({
      allowed: true,
      limit: 3,
      remaining: 2,
    });
    expect(limiter.consume('a', 3, 60 * SECOND).remaining).toBe(1);
    expect(limiter.consume('a', 3, 60 * SECOND).remaining).toBe(0);
  });

  it('refuses the next request and says when to retry', () => {
    for (let i = 0; i < 3; i++) limiter.consume('a', 3, 60 * SECOND);
    now += 20 * SECOND; // the first request was 20 s ago
    expect(limiter.consume('a', 3, 60 * SECOND)).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetSeconds: 40,
    });
  });

  it('does not count refused requests against the client', () => {
    for (let i = 0; i < 3; i++) limiter.consume('a', 3, 60 * SECOND);
    for (let i = 0; i < 10; i++) limiter.consume('a', 3, 60 * SECOND); // refused
    now += 60 * SECOND;
    expect(limiter.consume('a', 3, 60 * SECOND).allowed).toBe(true);
  });

  it('lets requests through again as old ones leave the window', () => {
    limiter.consume('a', 2, 60 * SECOND); // t = 0
    now += 30 * SECOND;
    limiter.consume('a', 2, 60 * SECOND); // t = 30
    expect(limiter.consume('a', 2, 60 * SECOND).allowed).toBe(false);
    now += 30 * SECOND; // t = 60: the first request is exactly a window old
    expect(limiter.consume('a', 2, 60 * SECOND).allowed).toBe(true);
    expect(limiter.consume('a', 2, 60 * SECOND).allowed).toBe(false);
  });

  it('counts each key separately', () => {
    for (let i = 0; i < 2; i++) limiter.consume('a', 2, 60 * SECOND);
    expect(limiter.consume('a', 2, 60 * SECOND).allowed).toBe(false);
    expect(limiter.consume('b', 2, 60 * SECOND).allowed).toBe(true);
  });

  it('forgets idle keys so memory does not grow forever', () => {
    limiter.consume('a', 5, 60 * SECOND);
    limiter.consume('b', 5, 60 * SECOND);
    now += 120 * SECOND;
    // The sweep runs every 1000 requests.
    for (let i = 0; i < 1000; i++)
      limiter.consume('busy', 100_000, 60 * SECOND);
    expect(limiter.size()).toBe(1); // only "busy" is left
  });
});

describe('RateLimitedException', () => {
  it('is a 429 with the headers from docs/api.md section 3', () => {
    const error = new RateLimitedException(40, 60);
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toEqual({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please wait and try again.',
      details: null,
    });
    expect(error.headers).toEqual({
      'Retry-After': '40',
      'RateLimit-Limit': '60',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': '40',
    });
  });
});
