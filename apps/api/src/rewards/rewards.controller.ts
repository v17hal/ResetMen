import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { walletQuery } from '@reset/types';
import type { z } from 'zod';

import { CurrentUser, CustomerGuard } from '../auth/auth.guards.js';
import { RateLimitGuard, RateLimited } from '../common/rate-limit.guard.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RewardsService } from './rewards.service.js';
import { ScratchService } from './scratch.service.js';
import { StreakService } from './streak.service.js';

@ApiTags('rewards')
@ApiBearerAuth()
@Controller('rewards')
@UseGuards(CustomerGuard)
export class RewardsController {
  constructor(
    private readonly rewards: RewardsService,
    private readonly scratch: ScratchService,
    private readonly streaks: StreakService,
    private readonly scope: StoreScopeService,
  ) {}

  /**
   * The wallet, optionally priced against a basket.
   *
   * Passing `serviceId` makes each row report what it would actually save and, when it
   * cannot be used, why — which is what lets the checkout screen grey a row out with an
   * explanation rather than just hiding it.
   */
  @Get('wallet')
  async wallet(
    @CurrentUser() userId: string,
    @Query(new ZodValidationPipe(walletQuery)) query: z.infer<typeof walletQuery>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.scope.resolve(header);

    return {
      data: await this.rewards.wallet({
        userId,
        storeId,
        basket: await this.rewards.basketFor(storeId, query.serviceId, query.addonOptionIds),
        includeUsed: query.includeUsed,
      }),
    };
  }

  @Get('streak')
  async streak(@CurrentUser() userId: string, @StoreIdHeader() header?: string) {
    return this.streaks.summaryFor(userId, await this.scope.resolve(header));
  }

  @Get('scratch-cards')
  async cards(@CurrentUser() userId: string) {
    return { data: await this.scratch.listCards(userId) };
  }

  /**
   * Reveals a card.
   *
   * The draw happens here, on the server, at the moment of the tap — never at issue time.
   * A prize decided in advance and stored on the card would be readable by anyone who
   * inspected the response before the animation finished.
   */
  @Post('scratch-cards/:id/scratch')
  @UseGuards(RateLimitGuard)
  @RateLimited({ limit: 30, windowSeconds: 3600 })
  async scratchCard(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.scratch.scratchCard(id, userId);
  }
}
