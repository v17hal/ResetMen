import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { adminSupportQuery, supportReply, supportStatusUpdate, uuid } from '@reset/types';
import type { z } from 'zod';

import { AdminGuard, CurrentAuth, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SupportService } from '../support/support.service.js';

/**
 * Help desk, staff side.
 *
 * Every role, counter staff included: whoever is on the desk answers the questions, the
 * same way whoever is on the desk used to answer the phone. Each reply records who sent it.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/support')
@UseGuards(AdminGuard, RolesGuard)
export class AdminSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  @Get()
  async list(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(adminSupportQuery)) query: z.infer<typeof adminSupportQuery>,
    @StoreIdHeader() header?: string,
  ) {
    return { data: await this.support.listForStaff(await this.storeFor(auth, header), query.status) };
  }

  /** For the badge on the sidebar. */
  @Get('unread-count')
  async unread(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return { count: await this.support.unreadCount(await this.storeFor(auth, header)) };
  }

  @Get(':id')
  async get(
    @CurrentAuth() auth: TokenClaims,
    @Param('id', new ZodValidationPipe(uuid)) id: string,
    @StoreIdHeader() header?: string,
  ) {
    return this.support.getForStaff(await this.storeFor(auth, header), id);
  }

  @Post(':id/messages')
  async reply(
    @CurrentAuth() auth: TokenClaims,
    @Param('id', new ZodValidationPipe(uuid)) id: string,
    @Body(new ZodValidationPipe(supportReply)) body: z.infer<typeof supportReply>,
    @StoreIdHeader() header?: string,
  ) {
    return this.support.replyAsStaff(await this.storeFor(auth, header), id, auth.sub, body.body);
  }

  @Put(':id/status')
  async status(
    @CurrentAuth() auth: TokenClaims,
    @Param('id', new ZodValidationPipe(uuid)) id: string,
    @Body(new ZodValidationPipe(supportStatusUpdate)) body: z.infer<typeof supportStatusUpdate>,
    @StoreIdHeader() header?: string,
  ) {
    return this.support.setStatusAsStaff(await this.storeFor(auth, header), id, body.status);
  }
}
