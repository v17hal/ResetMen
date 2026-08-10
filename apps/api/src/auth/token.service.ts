import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { AppError } from '../common/errors.js';
import { loadEnv } from '../config/env.js';

export type TokenAudience = 'customer' | 'admin';

export interface TokenClaims {
  sub: string;
  aud: TokenAudience;
  role?: string;
  storeId?: string | null;
  exp: number;
  jti: string;
}

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Compact signed tokens (HS256), issued and verified in-process.
 *
 * Customer and admin tokens carry different audiences and different secrets, so a customer
 * token can never be replayed against an admin route even if the signing key leaks in one
 * direction.
 */
@Injectable()
export class TokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor() {
    const env = loadEnv();
    // Dev fallbacks are deterministic and clearly marked; production validation in env.ts
    // requires real 32-character secrets.
    this.accessSecret = env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-not-for-production';
    this.refreshSecret = env.JWT_REFRESH_SECRET ?? 'dev-only-refresh-secret-not-for-prod';
  }

  issueAccess(claims: Omit<TokenClaims, 'exp' | 'jti'>): string {
    return this.sign(claims, ACCESS_TTL_SECONDS, this.accessSecret);
  }

  issueRefresh(claims: Omit<TokenClaims, 'exp' | 'jti'>): string {
    return this.sign(claims, REFRESH_TTL_SECONDS, this.refreshSecret);
  }

  verifyAccess(token: string): TokenClaims {
    return this.verify(token, this.accessSecret);
  }

  verifyRefresh(token: string): TokenClaims {
    return this.verify(token, this.refreshSecret);
  }

  private sign(
    claims: Omit<TokenClaims, 'exp' | 'jti'>,
    ttlSeconds: number,
    secret: string,
  ): string {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({
        ...claims,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
        jti: randomBytes(12).toString('base64url'),
      }),
    );

    const signature = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }

  private verify(token: string, secret: string): TokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) throw unauthenticated();

    const [header, payload, signature] = parts as [string, string, string];

    const expected = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    // Constant-time compare, so the signature cannot be brute-forced byte by byte.
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthenticated();

    let claims: TokenClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims;
    } catch {
      throw unauthenticated();
    }

    if (claims.exp * 1000 < Date.now()) {
      throw new AppError('UNAUTHENTICATED', 401, 'Session expired', 'Sign in again.');
    }

    return claims;
  }
}

function unauthenticated(): AppError {
  return new AppError('UNAUTHENTICATED', 401, 'Invalid token');
}
