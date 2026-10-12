import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { hashPassword, verifyPassword } from './password.js';
import { createSession, type SessionUser } from './sessions.js';

export class RateLimitedException extends ApiException {
  constructor(
    readonly retryAfterSeconds: number,
    readonly limit: number,
  ) {
    // Headers from docs/api.md section 3.
    super(
      429,
      'RATE_LIMITED',
      'Too many sign-in attempts. Please wait and try again.',
      null,
      {
        'Retry-After': String(retryAfterSeconds),
        'RateLimit-Limit': String(limit),
        'RateLimit-Remaining': '0',
        'RateLimit-Reset': String(retryAfterSeconds),
      },
    );
  }
}

@Injectable()
export class AuthService {
  // Checked when the email is unknown, so a wrong email takes as long as a
  // wrong password and the response doesn't reveal which accounts exist.
  private readonly dummyHash = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly limiter: LoginRateLimiter,
  ) {}

  // Checks the credentials and starts a session. Throws 401
  // INVALID_CREDENTIALS (one answer for a wrong email or password) or 429.
  async login(
    email: string,
    password: string,
    ip: string,
  ): Promise<{ token: string; user: SessionUser }> {
    const hit = this.limiter.check(ip, email);
    if (hit) throw new RateLimitedException(hit.retryAfterSeconds, hit.limit);
    this.limiter.recordAttempt(ip);

    const user = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'role', 'password_hash'])
      .where(({ fn, eb }) =>
        eb(fn('lower', ['email']), '=', email.toLowerCase()),
      )
      .executeTakeFirst();

    const passwordOk = await verifyPassword(
      user?.password_hash ?? (await this.dummyHash),
      password,
    );
    if (!user || !passwordOk) {
      this.limiter.recordFailure(ip, email);
      throw new ApiException(
        401,
        'INVALID_CREDENTIALS',
        'The email or password is incorrect.',
      );
    }

    this.limiter.recordSuccess(ip, email);
    const token = await createSession(this.db, user.id);
    return { token, user: { id: user.id, email: user.email, role: user.role } };
  }
}
