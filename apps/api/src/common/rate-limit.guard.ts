import { CanActivate, ExecutionContext, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppError } from './errors.js';
import { RedisService } from './redis.service.js';

export interface RateLimit {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Bucket by client IP (default) or by authenticated user. */
  by?: 'ip' | 'user';
}

export const RATE_LIMIT_KEY = 'reset:rate-limit';

/** `@RateLimited({ limit: 10, windowSeconds: 3600 })` */
export const RateLimited = (config: RateLimit) => SetMetadata(RATE_LIMIT_KEY, config);

interface Bucket {
  count: number;
  resetAt: number;
}

interface Hit {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiting, shared across replicas when Redis is available.
 *
 * Redis is the store when it is reachable, so two API processes enforce one limit rather
 * than one each. When it is not — no `REDIS_URL`, or Redis is down — this falls back to a
 * per-process map and says so once.
 *
 * **Failing open is deliberate.** A rate limiter that returns 500 when its backing store
 * blinks converts a minor infrastructure problem into a full outage, and the thing it is
 * protecting against is nuisance traffic. Degrading to per-process limits for a few seconds
 * is the cheaper failure.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly buckets = new Map<string, Bucket>();
  private warnedAboutFallback = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<RateLimit | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (config === undefined) return true;

    const request = context.switchToHttp().getRequest<Request & { auth?: { sub: string } }>();

    const identity =
      config.by === 'user' && request.auth !== undefined
        ? `user:${request.auth.sub}`
        : `ip:${request.ip ?? 'unknown'}`;

    const key = `${context.getClass().name}.${context.getHandler().name}:${identity}`;
    const hit = await this.hit(key, config.windowSeconds);

    if (hit.count > config.limit) {
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Too many requests',
        'Slow down and try again shortly.',
        { retryAfterSeconds: Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000)) },
      );
    }

    return true;
  }

  private async hit(key: string, windowSeconds: number): Promise<Hit> {
    const client = this.redis.client;

    if (client !== null) {
      try {
        const namespaced = `reset:rl:${key}`;

        // INCR then EXPIRE in one round trip. Setting the TTL only when the counter comes
        // back as 1 is what makes this a *fixed* window — re-expiring on every request
        // would slide the window forward and let a steady stream never reset.
        const results = await client
          .multi()
          .incr(namespaced)
          .ttl(namespaced)
          .exec();

        const count = Number(results?.[0]?.[1] ?? 0);
        let ttl = Number(results?.[1]?.[1] ?? -1);

        if (count === 1 || ttl < 0) {
          await client.expire(namespaced, windowSeconds);
          ttl = windowSeconds;
        }

        return { count, resetAt: Date.now() + ttl * 1000 };
      } catch (error) {
        this.warnFallbackOnce(error instanceof Error ? error.message : String(error));
      }
    }

    return this.hitInMemory(key, windowSeconds);
  }

  private hitInMemory(key: string, windowSeconds: number): Hit {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (bucket === undefined || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowSeconds * 1000 };
      this.buckets.set(key, fresh);
      this.sweep(now);
      return fresh;
    }

    bucket.count += 1;
    return bucket;
  }

  private warnFallbackOnce(reason: string): void {
    if (this.warnedAboutFallback) return;
    this.warnedAboutFallback = true;
    this.logger.warn(`Redis rate-limit store unavailable (${reason}) — falling back to in-memory.`);
  }

  /** Drop expired buckets occasionally so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
