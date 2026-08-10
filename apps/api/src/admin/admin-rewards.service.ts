import { Injectable } from '@nestjs/common';
import type { ScratchCampaignInput, StreakRuleInput } from '@reset/types';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { labelFor } from '../rewards/reward-math.js';

@Injectable()
export class AdminRewardsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Streak rules ───────────────────────────────────────────────────────────

  async listStreakRules(storeId: string) {
    const rules = await this.prisma.streakRule.findMany({
      where: { storeId },
      orderBy: [{ isActive: 'desc' }, { requiredVisits: 'asc' }],
      include: { rewardService: { select: { name: true } } },
    });

    return rules.map((rule) => ({
      ...rule,
      rewardLabel: labelFor(rule),
      rewardServiceName: rule.rewardService?.name ?? null,
    }));
  }

  async createStreakRule(storeId: string, input: StreakRuleInput) {
    await this.assertRewardServiceBelongs(storeId, input.rewardServiceId);

    return this.prisma.streakRule.create({
      data: { storeId, ...input },
    });
  }

  async updateStreakRule(storeId: string, id: string, input: StreakRuleInput) {
    const before = await this.prisma.streakRule.findFirst({ where: { id, storeId } });
    if (before === null) throw AppError.notFound('Streak rule');

    await this.assertRewardServiceBelongs(storeId, input.rewardServiceId);

    const after = await this.prisma.streakRule.update({ where: { id }, data: input });
    return { before, after };
  }

  /**
   * Deactivates rather than deletes.
   *
   * Rewards already granted point back at the rule that produced them, and a customer
   * asking "what was this for?" six weeks later deserves an answer.
   */
  async deactivateStreakRule(storeId: string, id: string) {
    const rule = await this.prisma.streakRule.findFirst({ where: { id, storeId } });
    if (rule === null) throw AppError.notFound('Streak rule');

    await this.prisma.streakRule.update({ where: { id }, data: { isActive: false } });
    return rule;
  }

  // ── Scratch campaigns ──────────────────────────────────────────────────────

  async listCampaigns(storeId: string) {
    const campaigns = await this.prisma.scratchCampaign.findMany({
      where: { storeId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { rewards: { orderBy: { weight: 'desc' } }, _count: { select: { cards: true } } },
    });

    return campaigns.map((campaign) => ({
      ...campaign,
      cardsIssued: campaign._count.cards,
      rewards: campaign.rewards.map((r) => ({
        ...r,
        stockRemaining: r.stockTotal === null ? null : Math.max(0, r.stockTotal - r.stockUsed),
      })),
    }));
  }

  async createCampaign(storeId: string, input: ScratchCampaignInput) {
    const { rewards, ...campaign } = input;

    return this.prisma.scratchCampaign.create({
      data: {
        storeId,
        ...campaign,
        startsAt: campaign.startsAt === null ? null : new Date(campaign.startsAt),
        endsAt: campaign.endsAt === null ? null : new Date(campaign.endsAt),
        rewards: { create: rewards },
      },
      include: { rewards: true },
    });
  }

  /**
   * Replaces a campaign's prize table.
   *
   * Existing prizes are matched by label and updated in place so their `stockUsed` survives
   * the edit — recreating them would reset every counter and re-issue prizes that have
   * already been won.
   */
  async updateCampaign(storeId: string, id: string, input: ScratchCampaignInput) {
    const before = await this.prisma.scratchCampaign.findFirst({
      where: { id, storeId },
      include: { rewards: true },
    });
    if (before === null) throw AppError.notFound('Campaign');

    const { rewards, ...campaign } = input;
    const existingByLabel = new Map(before.rewards.map((r) => [r.label, r]));

    const after = await this.prisma.$transaction(async (tx) => {
      await tx.scratchCampaign.update({
        where: { id },
        data: {
          ...campaign,
          startsAt: campaign.startsAt === null ? null : new Date(campaign.startsAt),
          endsAt: campaign.endsAt === null ? null : new Date(campaign.endsAt),
        },
      });

      const keptIds: string[] = [];

      for (const reward of rewards) {
        const existing = existingByLabel.get(reward.label);

        if (existing === undefined) {
          const created = await tx.scratchReward.create({
            data: { campaignId: id, ...reward },
          });
          keptIds.push(created.id);
          continue;
        }

        if (reward.stockTotal !== null && reward.stockTotal < existing.stockUsed) {
          throw AppError.validation(
            `"${reward.label}" has already been won ${existing.stockUsed} times; ` +
              `its stock cannot be reduced below that.`,
          );
        }

        await tx.scratchReward.update({ where: { id: existing.id }, data: reward });
        keptIds.push(existing.id);
      }

      // Prizes dropped from the table are deactivated, not deleted — cards already won
      // reference them.
      await tx.scratchReward.updateMany({
        where: { campaignId: id, id: { notIn: keptIds } },
        data: { isActive: false, weight: 0 },
      });

      return tx.scratchCampaign.findUniqueOrThrow({
        where: { id },
        include: { rewards: true },
      });
    });

    return { before, after };
  }

  async deactivateCampaign(storeId: string, id: string) {
    const campaign = await this.prisma.scratchCampaign.findFirst({ where: { id, storeId } });
    if (campaign === null) throw AppError.notFound('Campaign');

    await this.prisma.scratchCampaign.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * What a campaign costs.
   *
   * `expectedCostPerCardPaise` is the weighted mean payout of one scratch — the number to
   * multiply by expected card volume before switching a campaign on. Percentage and free-
   * session prizes are valued against the store's average booking, because their real cost
   * depends on what people actually book.
   */
  async campaignStats(storeId: string, id: string) {
    const campaign = await this.prisma.scratchCampaign.findFirst({
      where: { id, storeId },
      include: { rewards: true, _count: { select: { cards: true } } },
    });
    if (campaign === null) throw AppError.notFound('Campaign');

    const averageBooking = await this.prisma.booking.aggregate({
      where: { storeId, status: { in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] } },
      _avg: { payablePaise: true },
    });
    const basket = Math.round(averageBooking._avg.payablePaise ?? 0);

    const drawable = campaign.rewards.filter(
      (r) => r.isActive && r.weight > 0 && (r.stockTotal === null || r.stockUsed < r.stockTotal),
    );
    const totalWeight = drawable.reduce((sum, r) => sum + r.weight, 0);

    const slices = drawable.map((reward) => {
      const value = estimatedValuePaise(reward, basket);
      return {
        label: reward.label,
        rewardType: reward.rewardType,
        rewardValue: reward.rewardValue,
        weight: reward.weight,
        chancePercent: totalWeight === 0 ? 0 : Number(((reward.weight / totalWeight) * 100).toFixed(2)),
        estimatedValuePaise: value,
        stockTotal: reward.stockTotal,
        stockUsed: reward.stockUsed,
        stockRemaining: reward.stockTotal === null ? null : reward.stockTotal - reward.stockUsed,
      };
    });

    const expectedCostPerCardPaise =
      totalWeight === 0
        ? 0
        : Math.round(
            slices.reduce((sum, s) => sum + (s.weight / totalWeight) * s.estimatedValuePaise, 0),
          );

    const scratched = await this.prisma.scratchCard.count({
      where: { campaignId: id, status: 'SCRATCHED' },
    });

    return {
      campaignId: id,
      name: campaign.name,
      isActive: campaign.isActive,
      cardsIssued: campaign._count.cards,
      cardsScratched: scratched,
      averageBookingPaise: basket,
      expectedCostPerCardPaise,
      projectedCostAtCurrentVolumePaise: expectedCostPerCardPaise * campaign._count.cards,
      slices,
      /** True when every prize is exhausted — cards cannot be scratched until restocked. */
      exhausted: drawable.length === 0,
    };
  }

  private async assertRewardServiceBelongs(
    storeId: string,
    serviceId: string | null,
  ): Promise<void> {
    if (serviceId === null) return;

    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, storeId, deletedAt: null },
      select: { id: true },
    });
    if (service === null) throw AppError.notFound('Reward service');
  }
}

function estimatedValuePaise(
  reward: { rewardType: string; rewardValue: number },
  averageBasketPaise: number,
): number {
  switch (reward.rewardType) {
    case 'FLAT_OFF':
    case 'CASHBACK':
      return reward.rewardValue;
    case 'PERCENT_OFF':
      return Math.round((averageBasketPaise * Math.min(100, reward.rewardValue)) / 100);
    case 'FREE_SERVICE':
      return reward.rewardValue > 0
        ? Math.min(averageBasketPaise, reward.rewardValue)
        : averageBasketPaise;
    case 'FREE_ADDON':
      return reward.rewardValue;
    default:
      return 0;
  }
}
