import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { AppError } from '../common/errors.js';
import { loadEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { StreakService } from '../rewards/streak.service.js';

const PAYLOAD_PREFIX = 'RST1';

export interface CheckinResult {
  bookingId: string;
  publicId: string;
  customerName: string | null;
  customerPhone: string | null;
  serviceName: string;
  addons: string[];
  stationName: string;
  startsAt: string;
  durationMinutes: number;
  /** Shown on the counter screen so staff can congratulate, and hand over, a milestone. */
  streak: {
    current: number;
    required: number | null;
    milestoneReached: boolean;
    rewardLabel: string | null;
  } | null;
}

/**
 * QR check-in.
 *
 * The payload is `RST1.<publicId>.<hmac>`:
 *
 *  • **Signed**, so a code invented by hand fails verification rather than checking someone
 *    in against a booking they never made.
 *  • **Single use**, so a screenshot forwarded to a friend fails on the second scan.
 *  • **Guarded transition**, so even a valid token cannot move a booking out of CONFIRMED
 *    twice.
 *
 * All three matter: the proposal's stated purpose for the QR is preventing fake and
 * duplicate walk-ins.
 */
@Injectable()
export class CheckinService {
  private readonly logger = new Logger(CheckinService.name);
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly streaks: StreakService,
  ) {
    const env = loadEnv();
    this.secret = env.CHECKIN_HMAC_SECRET ?? 'dev-only-checkin-secret-not-for-production';
  }

  /** Issued when a booking is confirmed. Idempotent. */
  async issueToken(bookingId: string): Promise<string> {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { checkinToken: true },
    });

    const token =
      booking.checkinToken?.token ?? randomBytes(32).toString('base64url');

    if (booking.checkinToken === null) {
      await this.prisma.checkinToken.create({ data: { bookingId, token } });
    }

    return this.buildPayload(booking.publicId, token);
  }

  /** The string encoded into the QR image. */
  buildPayload(publicId: string, token: string): string {
    const signature = this.sign(publicId, token);
    return `${PAYLOAD_PREFIX}.${publicId}.${signature}`;
  }

  async payloadFor(bookingId: string): Promise<string | null> {
    const record = await this.prisma.checkinToken.findUnique({
      where: { bookingId },
      include: { booking: { select: { publicId: true } } },
    });
    if (record === null) return null;

    return this.buildPayload(record.booking.publicId, record.token);
  }

  /** Scanner path. */
  async redeemPayload(payload: string, adminId: string): Promise<CheckinResult> {
    const parts = payload.trim().split('.');
    if (parts.length !== 3 || parts[0] !== PAYLOAD_PREFIX) {
      throw new AppError('CHECKIN_INVALID', 400, 'Not a RESET code');
    }

    const [, publicId, signature] = parts as [string, string, string];

    const record = await this.prisma.checkinToken.findFirst({
      where: { booking: { publicId } },
      include: { booking: true },
    });
    if (record === null) throw new AppError('CHECKIN_INVALID', 400, 'Unknown code');

    const expected = Buffer.from(this.sign(publicId, record.token));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      this.logger.warn(`Rejected a check-in code with a bad signature for ${publicId}`);
      throw new AppError('CHECKIN_INVALID', 400, 'Code failed verification');
    }

    return this.completeCheckin(record.booking.id, adminId);
  }

  /**
   * Manual fallback — the counter's camera will fail, or a screen will be cracked, and the
   * queue does not stop for either.
   */
  async redeemPublicId(publicId: string, adminId: string): Promise<CheckinResult> {
    const booking = await this.prisma.booking.findUnique({
      where: { publicId: publicId.trim().toUpperCase() },
    });
    if (booking === null) throw new AppError('CHECKIN_INVALID', 400, 'Unknown booking code');

    return this.completeCheckin(booking.id, adminId);
  }

  private async completeCheckin(bookingId: string, adminId: string): Promise<CheckinResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: {
          addons: true,
          station: { select: { name: true } },
          user: { select: { id: true, name: true, phone: true } },
        },
      });

      if (booking.status === 'CHECKED_IN' || booking.status === 'IN_PROGRESS') {
        throw new AppError(
          'CHECKIN_ALREADY_USED',
          409,
          'Already checked in',
          `${booking.publicId} was checked in at ${booking.checkedInAt?.toISOString() ?? 'an earlier time'}.`,
        );
      }

      if (booking.status !== 'CONFIRMED') {
        throw new AppError(
          'CHECKIN_INVALID',
          400,
          'Booking is not checkable',
          `Its status is ${booking.status}.`,
        );
      }

      // Guarded transition: `status: 'CONFIRMED'` in the WHERE clause means two scanners
      // racing on the same code produce one winner and one clean 409.
      const updated = await tx.booking.updateMany({
        where: { id: bookingId, status: 'CONFIRMED' },
        data: { status: 'CHECKED_IN', checkedInAt: new Date() },
      });

      if (updated.count === 0) {
        throw new AppError('CHECKIN_ALREADY_USED', 409, 'Already checked in');
      }

      await tx.checkinToken.updateMany({
        where: { bookingId, usedAt: null },
        data: { usedAt: new Date(), usedByAdminId: adminId },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: 'CONFIRMED',
          toStatus: 'CHECKED_IN',
          actorType: 'ADMIN',
          actorId: adminId,
        },
      });

      const streak =
        booking.user === null
          ? null
          : await this.streaks.accrue(tx, booking.storeId, booking.user.id);

      return {
        bookingId: booking.id,
        publicId: booking.publicId,
        customerName: booking.user?.name ?? null,
        customerPhone: booking.user?.phone ?? null,
        serviceName: booking.serviceNameSnapshot,
        addons: booking.addons.map((a) => a.nameSnapshot),
        stationName: booking.station.name,
        startsAt: booking.startsAt.toISOString(),
        durationMinutes: booking.totalDurationMinutes,
        streak,
        userId: booking.user?.id ?? null,
        storeId: booking.storeId,
      };
    });

    const { userId, storeId, ...checkin } = result;

    // Scratch cards and push notifications happen *after* the transaction commits. They are
    // not worth failing a check-in for — the customer is standing at the counter, and a
    // notification that did not send is a far smaller problem than a check-in that did not
    // happen.
    if (userId !== null && result.streak !== null) {
      await this.streaks.afterCheckin({
        storeId,
        userId,
        bookingId: checkin.bookingId,
        outcome: result.streak,
      });
    }

    return checkin satisfies CheckinResult;
  }

  private sign(publicId: string, token: string): string {
    return createHmac('sha256', this.secret)
      .update(`${publicId}:${token}`)
      .digest('base64url')
      .slice(0, 22);
  }
}
