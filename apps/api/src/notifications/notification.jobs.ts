import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { NotificationTemplate } from '@reset/types';
import { DateTime } from 'luxon';

import { PrismaService } from '../database/prisma.service.js';
import { NotificationService } from './notification.service.js';

interface ReminderWindow {
  readonly template: NotificationTemplate;
  readonly minutesAhead: number;
  /** Width of the window swept each run. Must exceed the cron interval or reminders drop. */
  readonly toleranceMinutes: number;
}

/**
 * Two reminders, at T-60 and T-10.
 *
 * The windows are deliberately wider than the one-minute cron interval. A window exactly
 * as wide as the interval loses reminders whenever a run is a few seconds late — and the
 * duplicate that width risks is prevented properly, by checking the notification log.
 */
const REMINDERS: readonly ReminderWindow[] = [
  { template: 'booking_reminder_60', minutesAhead: 60, toleranceMinutes: 3 },
  { template: 'booking_reminder_10', minutesAhead: 10, toleranceMinutes: 3 },
];

@Injectable()
export class NotificationJobs {
  private readonly logger = new Logger(NotificationJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'booking-reminders' })
  async sendReminders(): Promise<void> {
    for (const window of REMINDERS) {
      await this.sweep(window);
    }
  }

  private async sweep(window: ReminderWindow): Promise<void> {
    const target = Date.now() + window.minutesAhead * 60_000;
    const from = new Date(target - window.toleranceMinutes * 60_000);
    const to = new Date(target + window.toleranceMinutes * 60_000);

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        userId: { not: null },
        startsAt: { gte: from, lte: to },
      },
      include: { store: { select: { timezone: true } } },
      take: 200,
    });

    for (const booking of bookings) {
      if (booking.userId === null) continue;

      // Dedupe against the log rather than against a flag on the booking: the log is the
      // record of what was actually sent, and it survives a reminder being re-run by hand.
      const alreadySent = await this.prisma.notificationLog.findFirst({
        where: {
          userId: booking.userId,
          template: window.template,
          payload: { path: ['bookingId'], equals: booking.id },
        },
        select: { id: true },
      });
      if (alreadySent !== null) continue;

      await this.notifications.send({
        userId: booking.userId,
        template: window.template,
        variables: {
          bookingId: booking.id,
          publicId: booking.publicId,
          serviceName: booking.serviceNameSnapshot,
          time: DateTime.fromJSDate(booking.startsAt)
            .setZone(booking.store.timezone)
            .toFormat('h:mm a'),
        },
      });
    }
  }

  /** The log is an operational record, not an archive. Ninety days is plenty to debug with. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'purge-notification-log' })
  async purgeOldLogs(): Promise<void> {
    const { count } = await this.prisma.notificationLog.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } },
    });

    if (count > 0) this.logger.log(`Purged ${count} notification log row(s)`);
  }
}
