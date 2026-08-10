import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../database/prisma.service.js';

/**
 * Reward housekeeping.
 *
 * Expiry is applied as a status change rather than being left implicit in a `validTill`
 * comparison. Reads already filter on the date, so this changes no behaviour at checkout —
 * what it changes is every report and every wallet screen, which would otherwise show
 * long-dead rewards as active and make the loyalty numbers meaningless.
 */
@Injectable()
export class RewardsJobs {
  private readonly logger = new Logger(RewardsJobs.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'expire-rewards' })
  async expireRewards(): Promise<void> {
    const { count } = await this.prisma.userReward.updateMany({
      where: { status: 'ACTIVE', validTill: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });

    if (count > 0) this.logger.log(`Expired ${count} reward(s)`);
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'expire-scratch-cards' })
  async expireScratchCards(): Promise<void> {
    const { count } = await this.prisma.scratchCard.updateMany({
      where: { status: 'ISSUED', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });

    if (count > 0) this.logger.log(`Expired ${count} unscratched card(s)`);
  }

  /**
   * Returns rewards held by bookings that never happened.
   *
   * `release` runs on the cancellation and expiry paths already; this catches the case
   * where the process died between the two writes. Without it the reward is stranded in
   * REDEEMED against a booking that no longer exists in any meaningful sense.
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'release-stranded-rewards' })
  async releaseStranded(): Promise<void> {
    const stranded = await this.prisma.userReward.findMany({
      where: {
        status: 'REDEEMED',
        validTill: { gte: new Date() },
        redemptions: { some: { status: { in: ['EXPIRED', 'CANCELLED'] } } },
      },
      select: { id: true },
      take: 200,
    });

    if (stranded.length === 0) return;

    const { count } = await this.prisma.userReward.updateMany({
      where: { id: { in: stranded.map((r) => r.id) }, status: 'REDEEMED' },
      data: { status: 'ACTIVE', redeemedBookingId: null },
    });

    this.logger.log(`Returned ${count} stranded reward(s) to their wallets`);
  }
}
