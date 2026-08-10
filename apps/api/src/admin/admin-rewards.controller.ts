import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { grantRewardInput, scratchCampaignInput, streakRuleInput } from '@reset/types';
import type { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit.service.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { NotificationService } from '../notifications/notification.service.js';
import { labelFor } from '../rewards/reward-math.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { AdminRewardsService } from './admin-rewards.service.js';

/**
 * Retention configuration.
 *
 * Owner and Manager only. These settings decide what the store gives away, and a mis-set
 * weight on a scratch campaign is a direct cost — the preview of expected value in
 * `campaignStats` exists so nobody has to work that out on paper.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/rewards')
@UseGuards(AdminGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class AdminRewardsController {
  constructor(
    private readonly admin: AdminRewardsService,
    private readonly rewards: RewardsService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly scope: StoreScopeService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  // ── Streak rules ───────────────────────────────────────────────────────────

  @Get('streak-rules')
  async listStreakRules(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return { data: await this.admin.listStreakRules(await this.storeFor(auth, header)) };
  }

  @Post('streak-rules')
  async createStreakRule(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(streakRuleInput)) body: z.infer<typeof streakRuleInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const created = await this.admin.createStreakRule(storeId, body);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'streak_rule.created',
      entityType: 'StreakRule',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  @Put('streak-rules/:id')
  async updateStreakRule(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(streakRuleInput)) body: z.infer<typeof streakRuleInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const { before, after } = await this.admin.updateStreakRule(storeId, id, body);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'streak_rule.updated',
      entityType: 'StreakRule',
      entityId: id,
      before,
      after,
    });

    return after;
  }

  @Delete('streak-rules/:id')
  async deleteStreakRule(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const before = await this.admin.deactivateStreakRule(storeId, id);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'streak_rule.deactivated',
      entityType: 'StreakRule',
      entityId: id,
      before,
    });

    return { deactivated: true };
  }

  // ── Scratch campaigns ──────────────────────────────────────────────────────

  @Get('campaigns')
  async listCampaigns(@CurrentAuth() auth: TokenClaims, @StoreIdHeader() header?: string) {
    return { data: await this.admin.listCampaigns(await this.storeFor(auth, header)) };
  }

  /**
   * Expected cost per card, and how much of each prize is left.
   *
   * The number the owner actually needs before switching a campaign on: weights are not
   * intuitive, and "1-in-10 wins ₹500" is easy to write and expensive to mean.
   */
  @Get('campaigns/:id/stats')
  async campaignStats(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    return this.admin.campaignStats(await this.storeFor(auth, header), id);
  }

  @Post('campaigns')
  async createCampaign(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(scratchCampaignInput)) body: z.infer<typeof scratchCampaignInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const created = await this.admin.createCampaign(storeId, body);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'scratch_campaign.created',
      entityType: 'ScratchCampaign',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  @Put('campaigns/:id')
  async updateCampaign(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(scratchCampaignInput)) body: z.infer<typeof scratchCampaignInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const { before, after } = await this.admin.updateCampaign(storeId, id, body);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'scratch_campaign.updated',
      entityType: 'ScratchCampaign',
      entityId: id,
      before,
      after,
    });

    return after;
  }

  @Delete('campaigns/:id')
  async deactivateCampaign(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    await this.admin.deactivateCampaign(storeId, id);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'scratch_campaign.deactivated',
      entityType: 'ScratchCampaign',
      entityId: id,
    });

    return { deactivated: true };
  }

  // ── Manual grants ──────────────────────────────────────────────────────────

  @Post('grants')
  async grant(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(grantRewardInput)) body: z.infer<typeof grantRewardInput>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);

    const reward = await this.rewards.grant({
      userId: body.userId,
      storeId,
      source: 'MANUAL',
      rewardType: body.rewardType,
      rewardValue: body.rewardValue,
      minOrderPaise: body.minOrderPaise,
      validityDays: body.validityDays,
    });

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'reward.granted',
      entityType: 'UserReward',
      entityId: reward.id,
      after: { ...reward, reason: body.reason },
    });

    await this.notifications.notifyRewardEarned(body.userId, labelFor(reward));

    return reward;
  }

  @Post('grants/:id/revoke')
  async revoke(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);
    const revoked = await this.rewards.revoke(id, storeId);

    await this.audit.record({
      storeId,
      adminUserId: auth.sub,
      action: 'reward.revoked',
      entityType: 'UserReward',
      entityId: id,
      after: revoked,
    });

    return revoked;
  }
}
