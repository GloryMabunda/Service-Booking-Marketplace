import { LoginRateLimiter } from './login-rate-limiter.js';

describe('LoginRateLimiter', () => {
  const MINUTE = 60_000;
  let now: number;
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    now = Date.UTC(2026, 9, 13, 8, 0, 0);
    limiter = new LoginRateLimiter(() => now);
  });

  const ip = '203.0.113.7';
  const email = 'owner@example.com';

  function failTimes(n: number, from = ip, who = email) {
    for (let i = 0; i < n; i++) {
      expect(limiter.check(from, who)).toBeNull();
      limiter.recordAttempt(from);
      limiter.recordFailure(from, who);
    }
  }

  it('allows the first 5 failed attempts for an IP and email', () => {
    failTimes(5);
  });

  it('blocks the 6th attempt within 15 minutes and says how long to wait', () => {
    failTimes(5);
    now += 5 * MINUTE;
    // The first failure was 5 minutes ago, so it expires in 10 minutes.
    expect(limiter.check(ip, email)).toEqual({
      retryAfterSeconds: 600,
      limit: 5,
    });
  });

  it('allows attempts again once the oldest failure is 15 minutes old', () => {
    failTimes(5);
    now += 15 * MINUTE;
    expect(limiter.check(ip, email)).toBeNull();
  });

  it('treats email case and spaces as the same account', () => {
    failTimes(5, ip, 'Owner@Example.com ');
    expect(limiter.check(ip, 'owner@example.com')).not.toBeNull();
  });

  it('does not block the same email from a different IP', () => {
    failTimes(5);
    expect(limiter.check('198.51.100.2', email)).toBeNull();
  });

  it('clears the failures after a successful login', () => {
    failTimes(4);
    limiter.recordSuccess(ip, email);
    failTimes(5);
  });

  it('allows 20 attempts per hour from one IP, whatever the emails', () => {
    for (let i = 0; i < 20; i++) {
      expect(limiter.check(ip, `person${i}@example.com`)).toBeNull();
      limiter.recordAttempt(ip);
    }
    expect(limiter.check(ip, 'someone-new@example.com')).toEqual({
      retryAfterSeconds: 3600,
      limit: 20,
    });
    now += 60 * MINUTE;
    expect(limiter.check(ip, 'someone-new@example.com')).toBeNull();
  });

  it('forgets old entries so memory does not grow forever', () => {
    failTimes(3);
    now += 2 * 60 * MINUTE;
    limiter.check('198.51.100.9', 'other@example.com');
    expect(limiter.size()).toBe(0);
  });
});
