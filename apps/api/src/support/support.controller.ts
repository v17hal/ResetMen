import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createSupportThread, supportReply, uuid } from '@reset/types';
import type { z } from 'zod';

import { CurrentUser, CustomerGuard } from '../auth/auth.guards.js';
import { RateLimitGuard, RateLimited } from '../common/rate-limit.guard.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SupportService } from './support.service.js';

/**
 * Help desk, customer side — client request 11/09/2026.
 *
 * Signed-in only. A question has to belong to somebody for the answer to reach them, and
 * an anonymous form is an open invitation to spam the owner's inbox.
 */
@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
@UseGuards(CustomerGuard)
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly scope: StoreScopeService,
  ) {}

  @Get('threads')
  async list(@CurrentUser() userId: string, @StoreIdHeader() header?: string) {
    return { data: await this.support.listForCustomer(userId, await this.scope.resolve(header)) };
  }

  @Post('threads')
  @UseGuards(RateLimitGuard)
  @RateLimited({ limit: 10, windowSeconds: 3600, by: 'user' })
  async create(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createSupportThread)) body: z.infer<typeof createSupportThread>,
    @StoreIdHeader() header?: string,
  ) {
    return this.support.createThread(userId, await this.scope.resolve(header), body);
  }

  @Get('threads/:id')
  async get(
    @CurrentUser() userId: string,
    @Param('id', new ZodValidationPipe(uuid)) id: string,
  ) {
    return this.support.getForCustomer(userId, id);
  }

  @Post('threads/:id/messages')
  @UseGuards(RateLimitGuard)
  @RateLimited({ limit: 60, windowSeconds: 3600, by: 'user' })
  async reply(
    @CurrentUser() userId: string,
    @Param('id', new ZodValidationPipe(uuid)) id: string,
    @Body(new ZodValidationPipe(supportReply)) body: z.infer<typeof supportReply>,
  ) {
    return this.support.replyAsCustomer(userId, id, body.body);
  }

  /** "My question is answered." Writing again reopens it. */
  @Post('threads/:id/close')
  async close(
    @CurrentUser() userId: string,
    @Param('id', new ZodValidationPipe(uuid)) id: string,
  ) {
    return this.support.closeAsCustomer(userId, id);
  }
}
