import { Injectable, Logger } from '@nestjs/common';
import type { ScratchCampaign, ScratchReward } from '@prisma/client';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { labelFor } from './reward-math.js';

export interface Weighted {
  readonly id: string;
  readonly weight: number;
}

/**
 * Weighted draw.
 *
 * Pure, exported and injectable-free so the distribution can be tested with a scripted
 * source of randomness instead of being trusted. A prize draw nobody can test is a prize
 * draw nobody should ship.
 */
export function drawWeighted<T extends Weighted>(items: readonly T[], roll: number): T | null {
  const eligible = items.filter((i) => i.weight > 0);
  if (eligible.length === 0) return null;

  const total = eligible.reduce((sum, i) => sum + i.weight, 0);
  let cursor = Math.min(Math.max(roll, 0), 0.999_999_999) * total;

  for (const item of eligible) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }

  return eligible[eligible.length - 1] ?? null;
}

@Injectable()
export class ScratchService {
  private readonly logger = new Logger(ScratchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues an unscratched card.
   *
   * One card per booking per campaign — the guard matters because check-in and the Nth-
   * booking trigger can both fire for the same visit.
   */
  async issueCard(params: {
    campaign: ScratchCampaign;
    userId: string;
    bookingId: string | null;
  }): Promise<void> {
    const now = new Date();
    if (params.campaign.startsAt !== null && params.campaign.startsAt > now) return;
    if (params.campaign.endsAt !== null && params.campaign.endsAt < now) return;

    if (params.bookingId !== null) {
      const existing = await this.prisma.scratchCard.findFirst({
        where: { campaignId: params.campaign.id, bookingId: params.bookingId },
        select: { id: true },
      });
      if (existing !== null) return;
    }

    // Cards outlive the campaign by their own expiry so a card issued on the last day is
    // still scratchable the next morning.
    await this.prisma.scratchCard.create({
      data: {
        userId: params.userId,
        campaignId: params.campaign.id,
        bookingId: params.bookingId,
        status: 'ISSUED',
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      },
    });

    this.logger.log(`Issued a scratch card to ${params.userId} for campaign ${params.campaign.name}`);
  }

  async listCards(userId: string) {
    const cards = await this.prisma.scratchCard.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { issuedAt: 'desc' }],
      take: 50,
      include: { campaign: { select: { name: true } }, scratchReward: true },
    });

    return cards.map((card) => ({
      id: card.id,
      campaignName: card.campaign.name,
      status: card.status,
      issuedAt: card.issuedAt.toISOString(),
      expiresAt: card.expiresAt?.toISOString() ?? null,
      reward:
        card.scratchReward === null
          ? null
          : {
              label: card.scratchReward.label,
              rewardType: card.scratchReward.rewardType,
              rewardValue: card.scratchReward.rewardValue,
              validTill: new Date(
                card.scratchedAt!.getTime() + card.scratchReward.validityDays * 86_400_000,
              ).toISOString(),
              rewardId: card.scratchRewardId!,
            },
    }));
  }

  /**
   * Reveals a card and grants what it wins.
   *
   * Three things have to be atomic or the mechanic is exploitable:
   *
   *  1. **Claiming the card** — guarded on `status: 'ISSUED'`, so a double-tap on a slow
   *     connection reveals one prize, not two.
   *  2. **Consuming stock** — a compare-and-increment in SQL, because "read stock, decide,
   *     write stock" hands out the last ₹500 voucher to everyone who taps at once.
   *  3. **Granting the reward** — in the same transaction as the card update, so a crash
   *     cannot leave a scratched card with nothing behind it.
   */
  async scratchCard(cardId: string, userId: string, roll: number = Math.random()) {
    const card = await this.prisma.scratchCard.findFirst({
      where: { id: cardId, userId },
      include: { campaign: true },
    });
    if (card === null) throw AppError.notFound('Scratch card');

    if (card.status === 'SCRATCHED') {
      throw new AppError('SCRATCH_ALREADY_USED', 409, 'Already scratched');
    }
    if (card.status === 'EXPIRED' || (card.expiresAt !== null && card.expiresAt < new Date())) {
      throw new AppError('SCRATCH_ALREADY_USED', 410, 'This card has expired');
    }

    // Claim first. Everything after this point runs at most once for this card.
    const claimed = await this.prisma.scratchCard.updateMany({
      where: { id: cardId, status: 'ISSUED' },
      data: { status: 'SCRATCHED', scratchedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new AppError('SCRATCH_ALREADY_USED', 409, 'Already scratched');
    }

    const won = await this.drawWithStock(card.campaignId, roll);

    if (won === null) {
      // Every prize is gone. Put the card back rather than burning it on nothing — the
      // owner can restock and the customer keeps their card.
      await this.prisma.scratchCard.updateMany({
        where: { id: cardId, status: 'SCRATCHED' },
        data: { status: 'ISSUED', scratchedAt: null },
      });

      this.logger.warn(`Campaign ${card.campaign.name} is out of stock — card ${cardId} returned`);
      throw new AppError(
        'REWARD_INVALID',
        409,
        'No prizes left',
        'This campaign has run out of prizes. Your card is safe — try again later.',
      );
    }

    const validTill = new Date(Date.now() + won.validityDays * 86_400_000);

    const reward = await this.prisma.$transaction(async (tx) => {
      const granted = await tx.userReward.create({
        data: {
          userId,
          storeId: card.campaign.storeId,
          source: 'SCRATCH_CARD',
          sourceId: card.id,
          rewardType: won.rewardType,
          rewardValue: won.rewardValue,
          minOrderPaise: 0,
          validTill,
          status: 'ACTIVE',
        },
      });

      await tx.scratchCard.update({
        where: { id: cardId },
        data: { scratchRewardId: won.id },
      });

      return granted;
    });

    this.logger.log(`${userId} scratched ${cardId} and won "${won.label}"`);

    return {
      cardId,
      reward: {
        rewardId: reward.id,
        label: won.label || labelFor(won),
        rewardType: won.rewardType,
        rewardValue: won.rewardValue,
        validTill: validTill.toISOString(),
      },
    };
  }

  /**
   * Draws a prize and consumes one unit of its stock in the same breath.
   *
   * Redraws when the compare-and-increment loses, excluding the reward that just sold out,
   * so a customer who happens to draw the last item of an exhausted prize still gets
   * something rather than an error.
   */
  private async drawWithStock(
    campaignId: string,
    roll: number,
  ): Promise<ScratchReward | null> {
    const excluded = new Set<string>();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidates = await this.prisma.scratchReward.findMany({
        where: { campaignId, isActive: true, weight: { gt: 0 }, id: { notIn: [...excluded] } },
      });

      const available = candidates.filter(
        (r) => r.stockTotal === null || r.stockUsed < r.stockTotal,
      );
      if (available.length === 0) return null;

      // Vary the roll per attempt so a redraw is not forced onto the same slice again.
      const picked = drawWeighted(available, (roll + attempt * 0.37) % 1);
      if (picked === null) return null;

      const taken = await this.prisma.$executeRaw`
        UPDATE scratch_rewards
           SET "stockUsed" = "stockUsed" + 1
         WHERE id = ${picked.id}::uuid
           AND ("stockTotal" IS NULL OR "stockUsed" < "stockTotal")
      `;

      if (taken === 1) return picked;

      excluded.add(picked.id);
    }

    return null;
  }
}
