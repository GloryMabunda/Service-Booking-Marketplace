import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { parseBody } from '../common/api-error.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import type { DB } from '../database/database.types.js';
import { CurrentUser, RequireAuth } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import {
  deleteSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  type SessionUser,
} from './sessions.js';

const loginSchema = z.strictObject({
  email: z
    .string({ error: 'Enter your email address.' })
    .trim()
    .max(254, 'Enter a valid email address.')
    .pipe(z.email('Enter a valid email address.')),
  password: z
    .string({ error: 'Enter your password.' })
    .min(1, 'Enter your password.')
    .max(256, 'The password is too long.'),
});

const toPublicUser = (user: SessionUser) => ({
  email: user.email,
  role: user.role,
});

// docs/api.md section 6 (#27).
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    @Inject(DATABASE) private readonly db: Kysely<DB>,
  ) {}

  // The session key goes in an HttpOnly cookie, never in the response body.
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = parseBody(loginSchema, body);
    const { token, user } = await this.auth.login(
      email,
      password,
      req.ip ?? 'unknown',
    );
    res.cookie(SESSION_COOKIE, token, this.cookieOptions());
    res.setHeader('Cache-Control', 'no-store');
    return { user: toPublicUser(user) };
  }

  @Post('logout')
  @HttpCode(204)
  @RequireAuth()
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cookies = req.cookies as Record<string, string>;
    await deleteSession(this.db, cookies[SESSION_COOKIE]);
    // Same options as when it was set, minus the lifetime.
    const { maxAge, ...options } = this.cookieOptions();
    res.clearCookie(SESSION_COOKIE, options);
  }

  // Who is signed in; the portal pages call this to decide whether to show
  // the login page.
  @Get('me')
  @RequireAuth()
  me(
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return { user: toPublicUser(user) };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true, // JavaScript on the page can't read it
      sameSite: 'strict', // never sent with requests from other sites
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production', // HTTPS only in production
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    };
  }
}
