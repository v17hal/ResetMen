import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { Observable, catchError, from, map, of, switchMap, throwError } from 'rxjs';

import { AppError } from './errors.js';
import { PrismaService } from '../database/prisma.service.js';

export const IDEMPOTENT_KEY = 'reset:idempotent';

export interface IdempotentOptions {
  /** How long a replay returns the stored response. */
  ttlSeconds?: number;
  /** Reject the request when no `Idempotency-Key` header is present. */
  required?: boolean;
}

/** `@Idempotent()` on any POST that creates money or capacity. */
export const Idempotent = (options: IdempotentOptions = {}) =>
  SetMetadata(IDEMPOTENT_KEY, options);

const DEFAULT_TTL_SECONDS = 24 * 3600;

/**
 * `Idempotency-Key` support.
 *
 * A customer on a train taps *Pay*, the response is lost to a tunnel, the app retries. That
 * retry must not produce a second booking and a second charge — it must produce the *same*
 * answer as the first attempt.
 *
 * Three behaviours, and the third is the one that matters:
 *
 *  1. **First use** — the handler runs, and its response is stored against the key.
 *  2. **Replay with the same payload** — the stored response is returned without the handler
 *     running again.
 *  3. **Replay with a *different* payload** — rejected with `IDEMPOTENT_REPLAY_MISMATCH`.
 *     A key reused for different content is a client bug, and silently returning the old
 *     response would hide it while quietly discarding whatever the customer just asked for.
 *
 * The key row is written **before** the handler runs, so two concurrent requests carrying the
 * same key cannot both proceed — the second loses the insert and waits on the first's result.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<IdempotentOptions | undefined>(
      IDEMPOTENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (options === undefined) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;

    if (key === undefined || key.length === 0) {
      if (options.required === true) {
        throw AppError.validation(
          'This request needs an Idempotency-Key header. Send a UUID and reuse it on retries.',
        );
      }
      return next.handle();
    }

    if (key.length > 200) {
      throw AppError.validation('Idempotency-Key must be at most 200 characters.');
    }

    const endpoint = `${request.method} ${request.route?.path ?? request.path}`;
    const requestHash = hashPayload(request.body);
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

    return from(this.claim({ key, endpoint, requestHash, ttlSeconds })).pipe(
      switchMap((claimed) => {
        if (claimed.replay !== undefined) return of(claimed.replay);

        return next.handle().pipe(
          // Awaited, not fire-and-forget. A client that retries the instant it sees the
          // response would otherwise race the write and be told the request is still in
          // progress — the exact retry this mechanism exists to serve.
          switchMap((response) => from(this.store(key, response)).pipe(map(() => response))),
          catchError((error: unknown) =>
            // A failed attempt must not poison the key. Releasing it before the error
            // propagates lets the customer retry the same request and actually get through.
            from(this.release(key)).pipe(switchMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }

  /**
   * Reserves the key, or returns the stored response for a replay.
   *
   * The insert is the lock: the primary key on `key` means exactly one caller creates the
   * row, and everyone else takes the replay path.
   */
  private async claim(params: {
    key: string;
    endpoint: string;
    requestHash: string;
    ttlSeconds: number;
  }): Promise<{ replay?: unknown }> {
    const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key: params.key,
          // Scoped per store in the schema; single-outlet installs share one, and the key
          // itself is expected to be a UUID, so this stays unique either way.
          storeId: await this.anyStoreId(),
          endpoint: params.endpoint,
          requestHash: params.requestHash,
          expiresAt,
        },
      });

      return {};
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key: params.key },
    });

    // Expired between the failed insert and this read. Treat it as a fresh key.
    if (existing === null || existing.expiresAt < new Date()) {
      await this.prisma.idempotencyKey.deleteMany({ where: { key: params.key } });
      return this.claim(params);
    }

    if (existing.requestHash !== params.requestHash || existing.endpoint !== params.endpoint) {
      throw new AppError(
        'IDEMPOTENT_REPLAY_MISMATCH',
        409,
        'Idempotency key reused',
        'That Idempotency-Key was already used for a different request. Generate a new one.',
      );
    }

    if (existing.response === null) {
      // The first attempt is still running, or died before storing anything. Refusing is
      // safer than running the handler a second time in parallel with it.
      throw new AppError(
        'IDEMPOTENT_REPLAY_MISMATCH',
        409,
        'Request already in progress',
        'An identical request is still being processed. Retry in a moment.',
        { retryAfterSeconds: 2 },
      );
    }

    this.logger.log(`Replayed idempotent response for ${params.endpoint}`);
    return { replay: existing.response };
  }

  private async store(key: string, response: unknown): Promise<void> {
    try {
      await this.prisma.idempotencyKey.update({
        where: { key },
        data: { response: (response ?? {}) as Prisma.InputJsonValue },
      });
    } catch (error) {
      this.logger.error(
        `Could not store idempotent response for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Drops the reservation.
   *
   * Unconditional on purpose: this is only reached after `claim` returned no replay, which
   * means *this* request created the row. There is nothing else it could delete.
   */
  private async release(key: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({ where: { key } }).catch(() => undefined);
  }

  private cachedStoreId: string | null = null;

  private async anyStoreId(): Promise<string> {
    if (this.cachedStoreId !== null) return this.cachedStoreId;

    const store = await this.prisma.store.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    this.cachedStoreId = store.id;
    return store.id;
  }
}

/**
 * Stable hash of the request body.
 *
 * Keys are sorted before hashing, so two JSON objects with the same content in a different
 * order are recognised as the same request rather than as a mismatch — clients and proxies
 * do not preserve key order and should not have to.
 */
function hashPayload(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);

  return `{${entries.join(',')}}`;
}
