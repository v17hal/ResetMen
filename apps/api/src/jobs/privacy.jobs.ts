import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { loadEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Data retention.
 *
 * The DPDP Act 2023 requires personal data to be erased once the purpose it was collected
 * for has ended. A customer who deletes their account has ended that purpose, and a
 * `deletedAt` timestamp is not erasure — it is a hidden row that still holds their phone
 * number.
 *
 * **Anonymise, do not delete.** Their bookings are the store's financial records: revenue,
 * GST, and the utilisation history the owner makes decisions from. Deleting the user row
 * would either destroy those or orphan them. So the row survives with every identifying
 * field removed, and the bookings keep pointing at something that is no longer a person.
 *
 * Everything that is *only* personal data — device tokens, notification history, unused
 * rewards, OTP records — is deleted outright.
 */
@Injectable()
export class PrivacyJobs {
  private readonly logger = new Logger(PrivacyJobs.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'purge-deleted-accounts' })
  async purgeDeletedAccounts(): Promise<void> {
    const retentionDays = loadEnv().DATA_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

    const due = await this.prisma.user.findMany({
      where: {
        deletedAt: { lt: cutoff },
        // `phone` is the marker: once anonymised it no longer looks like a number, so an
        // already-purged account is never processed twice.
        phone: { not: { startsWith: ANONYMISED_PREFIX } },
      },
      select: { id: true },
      take: 200,
    });

    if (due.length === 0) return;

    for (const user of due) {
      await this.purge(user.id);
    }

    this.logger.log(
      `Purged personal data from ${due.length} account(s) deleted more than ${retentionDays} days ago`,
    );
  }

  /**
   * Erases one account's personal data.
   *
   * In a transaction: a partial purge that stopped halfway would leave an account that is
   * neither usable nor erased, and nothing would come back for it — the next run skips it,
   * because its phone has already been rewritten.
   */
  async purge(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Deleted outright: personal data with no accounting value.
      await tx.deviceToken.deleteMany({ where: { userId } });
      await tx.notificationLog.deleteMany({ where: { userId } });
      await tx.scratchCard.deleteMany({ where: { userId, status: 'ISSUED' } });
      await tx.userReward.deleteMany({ where: { userId, status: { in: ['ACTIVE', 'EXPIRED'] } } });
      await tx.userStreak.deleteMany({ where: { userId } });

      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { phone: true },
      });
      await tx.otpCode.deleteMany({ where: { phone: user.phone } });

      // `phone` and `email` are unique, so a placeholder has to stay unique too. The id is
      // already unique and is not personal data once the name and number are gone.
      await tx.user.update({
        where: { id: userId },
        data: {
          phone: `${ANONYMISED_PREFIX}${userId}`,
          name: null,
          email: null,
          dateOfBirth: null,
          gender: 'UNDISCLOSED',
          preferredSegmentId: null,
          blockedReason: null,
          lastLoginAt: null,
          consentAt: null,
        },
      });

      // Booking notes are free text typed at the counter and routinely contain a name or a
      // phone number. The booking itself stays; the note does not.
      await tx.booking.updateMany({ where: { userId }, data: { notes: null } });
    });

    this.logger.log(`Anonymised account ${userId}`);
  }

  /**
   * Idempotency keys are a replay guard with a short useful life, not a record. Left alone
   * the table grows forever.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'purge-idempotency-keys' })
  async purgeIdempotencyKeys(): Promise<void> {
    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    if (count > 0) this.logger.log(`Purged ${count} expired idempotency key(s)`);
  }
}

/** Marks a row as already anonymised. Deliberately not a valid E.164 number. */
export const ANONYMISED_PREFIX = 'deleted-';
