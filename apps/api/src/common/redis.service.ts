import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { loadEnv } from '../config/env.js';

/**
 * Redis connection, optional by design.
 *
 * `REDIS_URL` is unset in plenty of valid setups — a developer's laptop, a CI runner, the
 * single-process launch topology. Callers get `null` and use their own fallback rather than
 * the process refusing to start.
 *
 * The connection **fails open**: if Redis goes away at runtime, `client` starts returning
 * null and whatever was using it degrades instead of taking the API down with it. For rate
 * limiting that is the right trade — a brief window of per-process limits is a far smaller
 * problem than an outage.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly connection: Redis | null;
  private healthy = false;

  readonly enabled: boolean;

  constructor() {
    const url = loadEnv().REDIS_URL;
    this.enabled = url !== undefined;

    if (url === undefined) {
      this.connection = null;
      this.logger.log('No REDIS_URL — features that can use Redis will use their fallback.');
      return;
    }

    this.connection = new Redis(url, {
      lazyConnect: true,
      // One retry, then give up and let the caller fall back. A rate-limit check must not
      // sit behind a reconnect storm while a customer waits on a booking.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
    });

    this.connection.on('ready', () => {
      this.healthy = true;
      this.logger.log('Connected to Redis');
    });

    this.connection.on('error', (error: Error) => {
      if (this.healthy) this.logger.error(`Redis connection lost: ${error.message}`);
      this.healthy = false;
    });

    void this.connection.connect().catch((error: Error) => {
      this.logger.warn(`Redis unavailable at startup (${error.message}) — using fallbacks.`);
    });
  }

  /** The live client, or null when Redis is absent or currently unreachable. */
  get client(): Redis | null {
    return this.healthy ? this.connection : null;
  }

  async ping(): Promise<boolean> {
    const client = this.client;
    if (client === null) return false;

    try {
      return (await client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.quit().catch(() => undefined);
  }
}
