import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../database/prisma.service.js';
import { RewardsService } from '../rewards/rewards.service.js';

/**
 * Scheduled maintenance of booking state.
 *
 * These run on the API process for now. When traffic justifies a separate worker they move
 * across unchanged — they only touch the database, never request state.
 */
@Injectable()
export class BookingJobs {
  private readonly logger = new Logger(BookingJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rewards: RewardsService,
  ) {}

  /**
   * Release holds whose TTL has elapsed.
   *
   * The booking transaction also sweeps inline, so a slot is never *wrongly* shown as busy.
   * This job exists so a slot frees up promptly even when nobody is trying to book it —
   * otherwise an abandoned checkout would block its slot until the next person happened to
   * attempt that exact time.
   */
  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'expire-holds' })
  async expireHolds(): Promise<void> {
    // Collected before the update so the rewards those holds were sitting on can be handed
    // back. A bulk `updateMany` alone would strand every reward attached to an abandoned
    // checkout — the customer would simply find it gone.
    const expiring = await this.prisma.booking.findMany({
      where: { status: 'HELD', holdExpiresAt: { lt: new Date() } },
      select: { id: true, appliedRewardId: true },
      take: 500,
    });

    if (expiring.length === 0) return;

    const { count } = await this.prisma.booking.updateMany({
      where: { id: { in: expiring.map((b) => b.id) }, status: 'HELD' },
      data: { status: 'EXPIRED' },
    });

    for (const booking of expiring) {
      if (booking.appliedRewardId !== null) await this.rewards.release(booking.id);
    }

    if (count > 0) this.logger.log(`Released ${count} expired hold(s)`);
  }

  /**
   * Mark no-shows.
   *
   * A confirmed booking whose slot has fully elapsed without a check-in is a no-show. The
   * station is released either way — the session time has passed — but recording it keeps
   * the no-show report honest, which is what tells the owner whether to introduce a
   * deposit.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'mark-no-shows' })
  async markNoShows(): Promise<void> {
    const graceMs = 15 * 60 * 1000;
    const cutoff = new Date(Date.now() - graceMs);

    const candidates = await this.prisma.booking.findMany({
      where: { status: 'CONFIRMED', endsAt: { lt: cutoff } },
      select: { id: true, publicId: true },
      take: 200,
    });

    for (const booking of candidates) {
      await this.prisma.$transaction([
        this.prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'NO_SHOW' },
        }),
        this.prisma.bookingStatusHistory.create({
          data: {
            bookingId: booking.id,
            fromStatus: 'CONFIRMED',
            toStatus: 'NO_SHOW',
            actorType: 'SYSTEM',
            reason: 'Not checked in within 15 minutes of the session ending',
          },
        }),
      ]);
    }

    if (candidates.length > 0) {
      this.logger.log(`Marked ${candidates.length} booking(s) as no-show`);
    }
  }

  /**
   * Close out sessions that finished while the customer was on the table.
   *
   * Without this, every checked-in booking would sit in CHECKED_IN forever and the
   * completed-bookings report would always read zero.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'complete-finished-sessions' })
  async completeFinishedSessions(): Promise<void> {
    const { count } = await this.prisma.booking.updateMany({
      where: {
        status: { in: ['CHECKED_IN', 'IN_PROGRESS'] },
        endsAt: { lt: new Date() },
      },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    if (count > 0) this.logger.log(`Completed ${count} finished session(s)`);
  }
}
