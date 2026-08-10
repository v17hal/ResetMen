import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { RewardsService } from './rewards.service.js';
import { ScratchService } from './scratch.service.js';
import { labelFor } from './reward-math.js';

export interface StreakOutcome {
  readonly current: number;
  readonly required: number | null;
  /** True on the check-in that completed a streak. */
  readonly milestoneReached: boolean;
  readonly rewardLabel: string | null;
}

/**
 * Visit streaks.
 *
 * Accrual happens on **check-in only**, never on booking (proposal §3.6). Someone who books
 * and does not turn up has not visited, and a loyalty scheme that rewards no-shows teaches
 * customers exactly the wrong thing.
 */
@Injectable()
export class StreakService {
  private readonly logger = new Logger(StreakService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rewards: RewardsService,
    private readonly scratch: ScratchService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Records a visit and pays out if it completes a streak.
   *
   * Runs inside the caller's check-in transaction, so the counter increment and the reward
   * it earns commit together — a customer can never be told "streak complete" and then find
   * no reward in their wallet.
   */
  async accrue(
    tx: Prisma.TransactionClient,
    storeId: string,
    userId: string,
  ): Promise<StreakOutcome> {
    const rule = await tx.streakRule.findFirst({
      where: { storeId, isActive: true },
      orderBy: { requiredVisits: 'asc' },
    });

    const now = new Date();
    const existing = await tx.userStreak.findUnique({ where: { userId } });

    const windowDays = rule?.withinDays ?? 30;
    const windowExpired =
      existing?.windowStartedAt == null ||
      now.getTime() - existing.windowStartedAt.getTime() > windowDays * 86_400_000;

    const current = windowExpired ? 1 : existing.currentCount + 1;
    const required = rule?.requiredVisits ?? null;
    const milestoneReached = required !== null && current >= required;

    await tx.userStreak.upsert({
      where: { userId },
      create: {
        userId,
        storeId,
        currentCount: milestoneReached ? 0 : 1,
        bestCount: 1,
        totalVisits: 1,
        lastCheckinAt: now,
        windowStartedAt: now,
      },
      update: {
        // Completing a streak starts the next one from zero, rather than leaving the
        // counter parked at the goal and paying out on every subsequent visit.
        currentCount: milestoneReached ? 0 : current,
        bestCount: Math.max(current, existing?.bestCount ?? 0),
        totalVisits: { increment: 1 },
        lastCheckinAt: now,
        ...(windowExpired || milestoneReached ? { windowStartedAt: now } : {}),
      },
    });

    if (!milestoneReached || rule === null) {
      return { current, required, milestoneReached: false, rewardLabel: null };
    }

    await this.rewards.grant({
      tx,
      userId,
      storeId,
      source: 'STREAK',
      sourceId: rule.id,
      rewardType: rule.rewardType,
      rewardValue: rule.rewardValue,
      validityDays: rule.validityDays,
    });

    const rewardLabel = labelFor(rule);
    this.logger.log(`${userId} completed streak "${rule.name}" and earned ${rewardLabel}`);

    return { current, required, milestoneReached: true, rewardLabel };
  }

  /**
   * Side effects that must not run inside the check-in transaction.
   *
   * Push notifications and scratch-card issuance are not worth failing a check-in for: the
   * customer is standing at the counter, and a notification that did not send is a smaller
   * problem than a check-in that did not happen.
   */
  async afterCheckin(params: {
    storeId: string;
    userId: string;
    bookingId: string;
    outcome: StreakOutcome;
  }): Promise<void> {
    try {
      // Cashback is earned by turning up, not by paying. Credited here, once the visit is
      // a fact — see RewardsService.creditCashback.
      const cashback = await this.rewards.creditCashback(params.bookingId);
      if (cashback.credited && cashback.label !== undefined) {
        await this.notifications.notifyCashbackCredited(params.userId, cashback.label);
      }

      const triggers: ('ON_CHECKIN' | 'ON_STREAK_COMPLETE')[] = ['ON_CHECKIN'];
      if (params.outcome.milestoneReached) triggers.push('ON_STREAK_COMPLETE');

      const campaigns = await this.prisma.scratchCampaign.findMany({
        where: { storeId: params.storeId, isActive: true, trigger: { in: triggers } },
      });

      for (const campaign of campaigns) {
        await this.scratch.issueCard({
          campaign,
          userId: params.userId,
          bookingId: params.bookingId,
        });
      }

      if (params.outcome.milestoneReached && params.outcome.rewardLabel !== null) {
        await this.notifications.notifyStreakMilestone(
          params.userId,
          params.outcome.rewardLabel,
        );
      } else if (campaigns.length > 0) {
        await this.notifications.notifyScratchCardIssued(params.userId);
      }
    } catch (error) {
      this.logger.error(
        `Post-check-in rewards failed for ${params.userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** The streak ring on the customer's home screen. */
  async summaryFor(userId: string, storeId: string) {
    const [streak, rule] = await Promise.all([
      this.prisma.userStreak.findUnique({ where: { userId } }),
      this.prisma.streakRule.findFirst({
        where: { storeId, isActive: true },
        orderBy: { requiredVisits: 'asc' },
      }),
    ]);

    const currentCount = streak?.currentCount ?? 0;

    return {
      currentCount,
      bestCount: streak?.bestCount ?? 0,
      totalVisits: streak?.totalVisits ?? 0,
      lastCheckinAt: streak?.lastCheckinAt?.toISOString() ?? null,
      goal:
        rule === null
          ? null
          : {
              name: rule.name,
              requiredVisits: rule.requiredVisits,
              withinDays: rule.withinDays,
              rewardLabel: labelFor(rule),
              remaining: Math.max(0, rule.requiredVisits - currentCount),
              windowEndsAt:
                streak?.windowStartedAt == null
                  ? null
                  : new Date(
                      streak.windowStartedAt.getTime() + rule.withinDays * 86_400_000,
                    ).toISOString(),
            },
    };
  }
}
