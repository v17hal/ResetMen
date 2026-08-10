import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

export interface AuditEntry {
  readonly storeId: string | null;
  readonly adminUserId: string | null;
  /** Verb in the past tense, dotted: `service.updated`, `booking.cancelled`. */
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ip?: string | null;
}

/**
 * Fields that must never reach the audit table.
 *
 * The `before`/`after` snapshots are whole rows, so anything sensitive on a row would be
 * copied into a table that is retained far longer than the row itself and read by more
 * people. Redaction happens here rather than at each call site, because the call site that
 * forgets is the one that matters.
 */
const REDACTED_KEYS = new Set([
  'passwordHash',
  'password',
  'totpSecret',
  'token',
  'codeHash',
  'refreshToken',
  'razorpaySignature',
]);

function redact(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (depth > 6) return '[nested]';

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1) ?? null) as Prisma.InputJsonValue;
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key) ? '[redacted]' : (redact(raw, depth + 1) ?? null);
    }
    return out as Prisma.InputJsonValue;
  }

  // bigint has no JSON representation and would throw on serialisation.
  if (typeof value === 'bigint') return value.toString();

  return value as Prisma.InputJsonValue;
}

/**
 * Who changed what.
 *
 * Deliberately best-effort: a failed audit write is logged and swallowed rather than
 * rolled back into the caller. Losing the record of a price change is bad; refusing to
 * save the price change because the audit table is full is worse, and the counter cannot
 * do anything about either at 8 p.m. on a Saturday.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          storeId: entry.storeId,
          adminUserId: entry.adminUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: redact(entry.before),
          after: redact(entry.after),
          ip: entry.ip ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry ${entry.action}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async list(params: {
    storeId: string;
    entityType?: string;
    entityId?: string;
    limit: number;
    cursor?: string;
  }) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        storeId: params.storeId,
        ...(params.entityType === undefined ? {} : { entityType: params.entityType }),
        ...(params.entityId === undefined ? {} : { entityId: params.entityId }),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit + 1,
      ...(params.cursor === undefined ? {} : { cursor: { id: params.cursor }, skip: 1 }),
      include: { adminUser: { select: { name: true, email: true } } },
    });

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    return {
      data: page.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actor: row.adminUser?.name ?? 'system',
        actorEmail: row.adminUser?.email ?? null,
        before: row.before,
        after: row.after,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
