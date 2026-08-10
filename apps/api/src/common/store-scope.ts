import { Injectable, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { AppError } from './errors.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Resolves the store for a request.
 *
 * Every table in the schema carries `storeId`, and every query is scoped by it. For a
 * single-outlet install the header is optional and the only active store is used — but the
 * plumbing exists from day one, because retrofitting store scoping onto a live system means
 * auditing every query in the codebase.
 */
@Injectable()
export class StoreScopeService {
  private cachedDefaultStoreId: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async resolve(headerValue: string | undefined): Promise<string> {
    if (headerValue !== undefined && headerValue.length > 0) return headerValue;

    if (this.cachedDefaultStoreId !== null) return this.cachedDefaultStoreId;

    const store = await this.prisma.store.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (store === null) throw AppError.notFound('Store');

    this.cachedDefaultStoreId = store.id;
    return store.id;
  }
}

/** `@StoreIdHeader() storeId: string | undefined` */
export const StoreIdHeader = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const header = request.headers['x-store-id'];
    return Array.isArray(header) ? header[0] : header;
  },
);
