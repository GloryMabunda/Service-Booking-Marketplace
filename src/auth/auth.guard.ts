import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Kysely } from 'kysely';
import { ApiException } from '../common/api-error.js';
import { DATABASE } from '../database/database.module.js';
import type { DB, UserRole } from '../database/database.types.js';
import { findSession, SESSION_COOKIE, type SessionUser } from './sessions.js';

// Authentication and authorization for the API (#27, docs/api.md section 6).
//
// - Every route under /api/admin/ needs a signed-in user automatically, so a
//   new admin endpoint can't be left unprotected by mistake.
// - Other routes opt in with @RequireAuth() (e.g. logout).
// - @Roles(...) lists the roles allowed; the default is ['admin']. More roles
//   can be added to the user_role enum later.
// - Requests that change something are refused when they come from another
//   site (CSRF), on top of the SameSite=Strict session cookie.

const REQUIRE_AUTH = 'auth:required';
const ROLES = 'auth:roles';

export const RequireAuth = () => SetMetadata(REQUIRE_AUTH, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
}

// The signed-in user, in a handler protected by this guard.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) throw unauthenticated();
    return req.user;
  },
);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Kysely<DB>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = req.originalUrl.split('?')[0];

    if (!SAFE_METHODS.has(req.method) && isCrossSite(req)) {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'This request came from another website and was blocked.',
      );
    }

    const targets = [context.getHandler(), context.getClass()];
    const required =
      path === '/api/admin' ||
      path.startsWith('/api/admin/') ||
      this.reflector.getAllAndOverride<boolean>(REQUIRE_AUTH, targets) === true;
    if (!required) return true;

    const cookies = req.cookies as Record<string, string> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    if (!token) throw unauthenticated();
    const user = await findSession(this.db, token);
    if (!user) throw unauthenticated();

    const allowed = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES,
      targets,
    ) ?? ['admin'];
    if (!allowed.includes(user.role)) {
      throw new ApiException(
        403,
        'FORBIDDEN',
        "You don't have permission to do that.",
      );
    }

    req.user = user;
    return true;
  }
}

function unauthenticated(): ApiException {
  return new ApiException(401, 'UNAUTHENTICATED', 'Please sign in.');
}

// True when the browser says the request came from a different site. Browsers
// send Sec-Fetch-Site and Origin on cross-site requests; tools like curl send
// neither, and are allowed (they can't carry a victim's cookie anyway).
function isCrossSite(req: Request): boolean {
  if (req.get('sec-fetch-site') === 'cross-site') return true;
  const origin = req.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.get('host');
  } catch {
    return true;
  }
}
