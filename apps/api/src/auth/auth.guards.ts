import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRole } from '@prisma/client';
import type { Request } from 'express';

import { AppError } from '../common/errors.js';
import { TokenService } from './token.service.js';
import type { TokenAudience, TokenClaims } from './token.service.js';

export interface AuthenticatedRequest extends Request {
  auth?: TokenClaims;
}

function bearer(request: Request): string | null {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

/**
 * Shared logic, deliberately a plain function rather than a base class.
 *
 * A subclass that declares no constructor of its own gets no `design:paramtypes` metadata
 * emitted for it, so Nest resolves zero dependencies and injects `undefined` — silently.
 * Every guard below therefore has its own explicit constructor.
 */
function authenticate(
  tokens: TokenService,
  context: ExecutionContext,
  audience: TokenAudience,
): boolean {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  const token = bearer(request);
  if (token === null) throw new AppError('UNAUTHENTICATED', 401, 'Sign in required');

  const claims = tokens.verifyAccess(token);

  // Customer and admin tokens are not interchangeable. Without this check a customer token
  // would open every admin route the guard protects.
  if (claims.aud !== audience) {
    throw new AppError('FORBIDDEN', 403, 'Wrong credentials for this area');
  }

  request.auth = claims;
  return true;
}

@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    return authenticate(this.tokens, context, 'customer');
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    return authenticate(this.tokens, context, 'admin');
  }
}

export const ROLES_KEY = 'reset:roles';

/** `@Roles('OWNER', 'MANAGER')` — omit to allow any signed-in admin. */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Role check. Counter staff can check people in and take walk-ins; only owners and managers
 * can touch pricing or capacity.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.auth?.role as AdminRole | undefined;

    if (role === undefined || !required.includes(role)) {
      throw new AppError(
        'FORBIDDEN',
        403,
        'Not permitted',
        `This action needs one of: ${required.join(', ')}.`,
      );
    }

    return true;
  }
}

/** `@CurrentUser() userId: string` */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.auth === undefined) {
      throw new AppError('UNAUTHENTICATED', 401, 'Sign in required');
    }
    return request.auth.sub;
  },
);

/** `@CurrentAuth() auth: TokenClaims` */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TokenClaims => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.auth === undefined) {
      throw new AppError('UNAUTHENTICATED', 401, 'Sign in required');
    }
    return request.auth;
  },
);

/** `@OptionalUser() userId: string | null` — for routes behind `OptionalCustomerGuard`. */
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.auth?.sub ?? null;
  },
);

/**
 * Optional authentication: attaches claims when a valid token is present, and does not fail
 * when one is not. Used by `/bookings/hold`, which must work for a signed-in customer and
 * for a staff-created walk-in with no account.
 */
@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearer(request);
    if (token === null) return true;

    try {
      const claims = this.tokens.verifyAccess(token);
      if (claims.aud === 'customer') request.auth = claims;
    } catch {
      // A malformed token on an optional route is treated as no token at all.
    }

    return true;
  }
}
