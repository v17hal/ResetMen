import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { storeProfileInput } from '@reset/types';
import type { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit.service.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminStoreService } from './admin-store.service.js';

/**
 * Shop details and who it serves. Owner and Manager: this is what customers and Google
 * read, so it is audited like a catalog change rather than done quietly.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/store')
@UseGuards(AdminGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class AdminStoreController {
  constructor(
    private readonly store: AdminStoreService,
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  @Get()
  async get(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return this.store.get(await this.storeFor(auth, header));
  }

  @Put()
  async update(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(storeProfileInput)) body: z.infer<typeof storeProfileInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const before = await this.store.get(storeId);
    const after = await this.store.update(storeId, body);
    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'store.updated',
      entityType: 'Store',
      entityId: storeId,
      before,
      after,
    });
    return after;
  }
}
