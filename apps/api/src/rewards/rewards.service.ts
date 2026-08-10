import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, RewardType, UserReward } from '@prisma/client';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { ScratchService } from './scratch.service.js';
import {
  blockingReason,
  discountFor,
  labelFor,
  postVisitCreditFor,
  subtotalOf,
} from './reward-math.js';
import type { Basket } from './reward-math.js';

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scratch: ScratchService,
  ) {}

  /**
   * The customer's wallet, priced against a specific basket when one is supplied.
   *
   * Applicability is decided here rather than in the app: minimum-order rules, expiry and
   * "nothing to discount" are business rules, and business rules in a client are business
   * rules you cannot change without a store release.
   */
  async wallet(params: {
    userId: string;
    storeId: string;
    basket: Basket | null;
    includeUsed: boolean;
  }) {
    const now = new Date();

    const rewards = await this.prisma.userReward.findMany({
      where: {
        userId: params.userId,
        storeId: params.storeId,
        ...(params.includeUsed ? {} : { status: 'ACTIVE', validTill: { gte: now } }),
      },
      orderBy: [{ status: 'asc' }, { validTill: 'asc' }],
      take: 100,
    });

    return rewards.map((reward) => {
      const reason = blockingReason(reward, params.basket, now);

      return {
        id: reward.id,
        source: reward.source,
        rewardType: reward.rewardType,
        rewardValue: reward.rewardValue,
        label: labelFor(reward),
        minOrderPaise: reward.minOrderPaise,
        validTill: reward.validTill.toISOString(),
        status: reward.status,
        applicable: reason === null,
        blockedReason: reason,
        discountPaise:
          params.basket === null || reason !== null ? 0 : discountFor(reward, params.basket),
        postVisitCreditPaise:
          params.basket === null || reason !== null ? 0 : postVisitCreditFor(reward, params.basket),
      };
    });
  }

  /**
   * Prices a reward against a basket without consuming it. Used by `/bookings/quote`.
   *
   * Throws rather than silently returning zero: a customer who picked a reward and sees no
   * change in the total will assume the app is broken, and they will be right.
   *
   * Both money figures come back, for the same reason `wallet()` reports both. Cashback
   * discounts nothing at checkout, so a caller with only `discountPaise` would render a
   * selected reward that appears to do nothing — the exact failure the wallet was fixed for.
   */
  async priceWith(params: {
    rewardId: string;
    userId: string | null;
    storeId: string;
    basket: Basket;
  }): Promise<{ reward: UserReward; discountPaise: number; postVisitCreditPaise: number }> {
    if (params.userId === null) {
      throw new AppError('REWARD_INVALID', 422, 'Sign in to use a reward');
    }

    const reward = await this.prisma.userReward.findFirst({
      where: { id: params.rewardId, userId: params.userId, storeId: params.storeId },
    });
    if (reward === null) throw new AppError('REWARD_INVALID', 404, 'Reward not found');

    const reason = blockingReason(reward, params.basket, new Date());
    if (reason !== null) {
      throw new AppError('REWARD_INVALID', 422, 'Reward cannot be used', reason);
    }

    return {
      reward,
      discountPaise: discountFor(reward, params.basket),
      postVisitCreditPaise: postVisitCreditFor(reward, params.basket),
    };
  }

  /**
   * Claims a reward for a booking, atomically.
   *
   * `status: 'ACTIVE'` in the WHERE clause is the single-use guarantee: two checkouts
   * racing on the same reward produce one winner and one clean rejection, with no read
   * beforehand to go stale in between.
   *
   * Reserved at *hold* time rather than at payment, so the discount cannot be shown twice
   * on two simultaneous baskets. An abandoned checkout gives it back — see `release`.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    params: { rewardId: string; userId: string; bookingId: string },
  ): Promise<void> {
    const claimed = await tx.userReward.updateMany({
      where: { id: params.rewardId, userId: params.userId, status: 'ACTIVE', validTill: { gte: new Date() } },
      data: { status: 'REDEEMED', redeemedBookingId: params.bookingId },
    });

    if (claimed.count === 0) {
      throw new AppError(
        'REWARD_INVALID',
        409,
        'Reward already used',
        'That reward was used on another booking.',
      );
    }
  }

  /**
   * Returns a reserved reward to the wallet when its booking never completed.
   *
   * Called on expiry and cancellation. Without it, an abandoned checkout silently eats a
   * reward — which is exactly the kind of quiet loss that erodes trust in a loyalty scheme.
   */
  async release(bookingId: string): Promise<void> {
    const restored = await this.prisma.userReward.updateMany({
      where: { redeemedBookingId: bookingId, status: 'REDEEMED', validTill: { gte: new Date() } },
      data: { status: 'ACTIVE', redeemedBookingId: null },
    });

    if (restored.count > 0) {
      this.logger.log(`Returned ${restored.count} reward(s) to the wallet after booking ${bookingId} ended`);
    }
  }

  /** Grants a reward directly. The counter's "sorry about the wait" lever, and the streak payout. */
  async grant(params: {
    userId: string;
    storeId: string;
    source: 'SCRATCH_CARD' | 'STREAK' | 'PROMO' | 'MANUAL';
    sourceId?: string | null;
    rewardType: RewardType;
    rewardValue: number;
    minOrderPaise?: number;
    validityDays: number;
    tx?: Prisma.TransactionClient;
  }): Promise<UserReward> {
    const db = params.tx ?? this.prisma;

    return db.userReward.create({
      data: {
        userId: params.userId,
        storeId: params.storeId,
        source: params.source,
        sourceId: params.sourceId ?? null,
        rewardType: params.rewardType,
        rewardValue: params.rewardValue,
        minOrderPaise: params.minOrderPaise ?? 0,
        validTill: new Date(Date.now() + params.validityDays * 86_400_000),
        status: 'ACTIVE',
      },
    });
  }

  /**
   * Hook for "your Nth booking earns a scratch card" campaigns.
   *
   * Counts confirmed bookings rather than all bookings, so abandoned holds do not inflate
   * anyone towards a prize.
   */
  async onBookingConfirmed(storeId: string, userId: string, bookingId: string): Promise<void> {
    const campaigns = await this.prisma.scratchCampaign.findMany({
      where: { storeId, isActive: true, trigger: 'ON_NTH_BOOKING' },
    });
    if (campaigns.length === 0) return;

    const confirmedCount = await this.prisma.booking.count({
      where: {
        userId,
        storeId,
        status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'] },
      },
    });

    for (const campaign of campaigns) {
      const n = campaign.triggerValue ?? 0;
      if (n <= 0) continue;
      if (confirmedCount % n !== 0) continue;

      await this.scratch.issueCard({ campaign, userId, bookingId });
    }
  }

  /**
   * Pays out cashback once a visit has actually happened.
   *
   * Cashback deliberately discounts nothing at checkout — that is what makes it cashback
   * rather than a discount. The money comes back afterwards, as a `FLAT_OFF` reward in the
   * wallet, which is what every Indian app this store's customers already use means by the
   * word.
   *
   * Paid on **check-in, not on payment**: someone who books, pays and never turns up has not
   * earned anything, and paying them would make no-shows profitable.
   *
   * Idempotent via `sourceId` — a re-run of check-in cannot credit twice.
   */
  async creditCashback(bookingId: string): Promise<{ credited: boolean; label?: string }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { appliedReward: true },
    });

    if (booking?.userId == null) return { credited: false };
    if (booking.appliedReward === null) return { credited: false };
    if (booking.appliedReward.rewardType !== 'CASHBACK') return { credited: false };

    const already = await this.prisma.userReward.findFirst({
      where: { userId: booking.userId, source: 'PROMO', sourceId: booking.id },
      select: { id: true },
    });
    if (already !== null) return { credited: false };

    const amountPaise = Math.min(booking.appliedReward.rewardValue, booking.payablePaise);
    if (amountPaise <= 0) return { credited: false };

    const credited = await this.grant({
      userId: booking.userId,
      storeId: booking.storeId,
      source: 'PROMO',
      // The booking, not the original reward: that is what makes the guard above work, and
      // it is also the honest answer to "what was this for?".
      sourceId: booking.id,
      rewardType: 'FLAT_OFF',
      rewardValue: amountPaise,
      validityDays: 90,
    });

    this.logger.log(`Credited ${amountPaise} paise cashback to ${booking.userId} for ${booking.publicId}`);
    return { credited: true, label: labelFor(credited) };
  }

  async revoke(rewardId: string, storeId: string) {
    const reward = await this.prisma.userReward.findFirst({ where: { id: rewardId, storeId } });
    if (reward === null) throw AppError.notFound('Reward');

    if (reward.status === 'REDEEMED') {
      throw AppError.validation('This reward has already been used and cannot be revoked.');
    }

    return this.prisma.userReward.update({
      where: { id: rewardId },
      data: { status: 'REVOKED' },
    });
  }

  /** Used by the quote path, which needs the number without the wallet row around it. */
  discountOf(reward: UserReward, basket: Basket): number {
    return subtotalOf(basket) === 0 ? 0 : discountFor(reward, basket);
  }

  /**
   * Prices a basket for wallet applicability checks.
   *
   * Deliberately a small independent read rather than a call into `BookingService.quote`:
   * that would make rewards depend on booking while booking already depends on rewards, and
   * a cycle in a modular monolith is how the monolith stops being modular.
   */
  async basketFor(
    storeId: string,
    serviceId: string | undefined,
    addonOptionIds: readonly string[],
  ): Promise<Basket | null> {
    if (serviceId === undefined) return null;

    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, storeId, deletedAt: null },
      select: { pricePaise: true },
    });
    if (service === null) return null;

    const addons =
      addonOptionIds.length === 0
        ? []
        : await this.prisma.addonOption.findMany({
            where: { id: { in: [...addonOptionIds] }, isActive: true },
            select: { pricePaise: true },
          });

    return {
      basePricePaise: service.pricePaise,
      addonsPricePaise: addons.reduce((sum, a) => sum + a.pricePaise, 0),
    };
  }
}
