// Login limits from docs/api.md section 3 (#27):
//   - 5 failed attempts per 15 minutes per IP address and email
//   - 20 attempts per hour per IP address
// Counts are kept in memory, which is right for v1's single app instance; a
// restart forgets them. Sliding windows: an attempt stops counting once it is
// older than the window.

const FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const IP_WINDOW_MS = 60 * 60_000;
const MAX_IP_ATTEMPTS = 20;

export interface RateLimitHit {
  retryAfterSeconds: number;
  // The limit that was reached (for the RateLimit-Limit header).
  limit: number;
}

// Created by a factory in AuthModule; tests pass a fake clock.
export class LoginRateLimiter {
  // key → timestamps (ms) of the attempts still inside the window
  private readonly failures = new Map<string, number[]>();
  private readonly ipAttempts = new Map<string, number[]>();

  constructor(private readonly clock: () => number = Date.now) {}

  // null when the attempt may go ahead, otherwise how long to wait.
  check(ip: string, email: string): RateLimitHit | null {
    const now = this.clock();
    this.prune(now);
    const ipWait = this.limitHit(
      this.ipAttempts.get(ip),
      MAX_IP_ATTEMPTS,
      IP_WINDOW_MS,
      now,
    );
    const failureWait = this.limitHit(
      this.failures.get(failureKey(ip, email)),
      MAX_FAILURES,
      FAILURE_WINDOW_MS,
      now,
    );
    // When both limits are reached, report the one that lasts longer.
    if (ipWait !== null && (failureWait === null || ipWait >= failureWait)) {
      return toHit(ipWait, MAX_IP_ATTEMPTS);
    }
    if (failureWait !== null) return toHit(failureWait, MAX_FAILURES);
    return null;
  }

  recordAttempt(ip: string): void {
    push(this.ipAttempts, ip, this.clock());
  }

  recordFailure(ip: string, email: string): void {
    push(this.failures, failureKey(ip, email), this.clock());
  }

  recordSuccess(ip: string, email: string): void {
    this.failures.delete(failureKey(ip, email));
  }

  // Number of keys being tracked (for tests).
  size(): number {
    return this.failures.size + this.ipAttempts.size;
  }

  // Milliseconds until the oldest counted attempt leaves the window, or null
  // when there is room for another attempt.
  private limitHit(
    times: number[] | undefined,
    max: number,
    windowMs: number,
    now: number,
  ): number | null {
    if (!times || times.length < max) return null;
    return times[times.length - max] + windowMs - now;
  }

  private prune(now: number): void {
    dropOlderThan(this.failures, now - FAILURE_WINDOW_MS);
    dropOlderThan(this.ipAttempts, now - IP_WINDOW_MS);
  }
}

function toHit(waitMs: number, limit: number): RateLimitHit {
  return { retryAfterSeconds: Math.ceil(waitMs / 1000), limit };
}

function failureKey(ip: string, email: string): string {
  return `${ip}|${email.trim().toLowerCase()}`;
}

function push(map: Map<string, number[]>, key: string, time: number): void {
  const times = map.get(key);
  if (times) times.push(time);
  else map.set(key, [time]);
}

function dropOlderThan(map: Map<string, number[]>, cutoff: number): void {
  for (const [key, times] of map) {
    const kept = times.filter((t) => t > cutoff);
    if (kept.length === 0) map.delete(key);
    else if (kept.length !== times.length) map.set(key, kept);
  }
}
