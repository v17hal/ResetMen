import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RedisService } from './redis.service.js';
import { StoreScopeService } from './store-scope.js';

/**
 * Cross-cutting infrastructure, global so guards and interceptors resolve anywhere.
 *
 * This exists because of a real failure: `RateLimitGuard` gained a `RedisService`
 * dependency while it was provided only in `AppModule`. `AuthModule` is its own (global)
 * module context, so the guard on `/auth/otp/request` could no longer be constructed — and
 * Nest reports that as a startup error rather than a route-level one, taking the whole API
 * down.
 *
 * Anything a controller in *another* module can reach for belongs here, not in `AppModule`.
 */
@Global()
@Module({
  providers: [
    RedisService,
    StoreScopeService,
    RateLimitGuard,
    IdempotencyInterceptor,
    AuditService,
  ],
  exports: [RedisService, StoreScopeService, RateLimitGuard, IdempotencyInterceptor, AuditService],
})
export class CommonModule {}
