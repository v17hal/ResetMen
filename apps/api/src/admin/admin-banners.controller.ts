import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { bannerInput, uuid } from '@reset/types';
import type { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit.service.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminBannersService } from './admin-banners.service.js';

/**
 * Home-screen banners. Owner and Manager — what the shop advertises is a menu decision,
 * not a counter one. Audited like every other catalog change.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/banners')
@UseGuards(AdminGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class AdminBannersController {
  constructor(
    private readonly banners: AdminBannersService,
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  @Get()
  async list(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return { data: await this.banners.list(await this.storeFor(auth, header)) };
  }

  @Post()
  async create(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(bannerInput)) body: z.infer<typeof bannerInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const banner = await this.banners.create(storeId, body);
    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'banner.created',
      entityType: 'Banner',
      entityId: banner.id,
      after: banner,
    });
    return banner;
  }

  @Put(':id')
  async update(
    @CurrentAuth() auth: TokenClaims,
    @Param('id', new ZodValidationPipe(uuid)) id: string,
    @Body(new ZodValidationPipe(bannerInput)) body: z.infer<typeof bannerInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const { before, after } = await this.banners.update(storeId, id, body);
    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'banner.updated',
      entityType: 'Banner',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  @Delete(':id')
  async remove(
    @CurrentAuth() auth: TokenClaims,
    @Param('id', new ZodValidationPipe(uuid)) id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const before = await this.banners.remove(storeId, id);
    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'banner.deleted',
      entityType: 'Banner',
      entityId: id,
      before,
    });
    return { deleted: true };
  }
}
