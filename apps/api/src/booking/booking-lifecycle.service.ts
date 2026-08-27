import { Injectable, Logger } from '@nestjs/common';
import type { BookingStatus, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';

import { toIso } from '../availability/availability.service.js';
import { CheckinService } from '../checkin/checkin.service.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { RewardsService } from '../rewards/rewards.service.js';

/**
 * Which status transitions are legal.
 *
 * Expressed as data rather than scattered `if` statements so that every path — customer
 * cancel, admin override, payment webhook, scheduled job — is checked against the same
 * table. An illegal transition is a bug, and this is where it gets caught.
 */
const ALLOWED_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  HELD: ['CONFIRMED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  EXPIRED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

@Injectable()
export class BookingLifecycleService {
  private readonly logger = new Logger(BookingLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkin: CheckinService,
    private readonly rewards: RewardsService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Marks a held booking confirmed and issues its QR.
   *
   * Called by the payment webhook, which is authoritative. Idempotent, because Razorpay
   * retries webhooks and a second delivery must not produce a second confirmation.
   */
  async confirm(bookingId: string, actorId: string | null): Promise<{ checkinPayload: string }> {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

    if (booking.status === 'CONFIRMED') {
      const payload = await this.checkin.payloadFor(bookingId);
      return { checkinPayload: payload ?? (await this.checkin.issueToken(bookingId)) };
    }

    if (booking.status === 'EXPIRED' || booking.status === 'CANCELLED') {
      // Payment landed after the hold lapsed and the slot may have gone to someone else.
      // The caller (payment module) refunds; we refuse to resurrect the booking silently.
      throw new AppError(
        'HOLD_EXPIRED',
        410,
        'Your hold expired',
        'The slot was released before payment completed. A refund has been initiated.',
      );
    }

    if (!canTransition(booking.status, 'CONFIRMED')) {
      throw AppError.validation(`Cannot confirm a booking that is ${booking.status}.`);
    }

    /**
     * Claim an unowned hold for whoever is confirming it.
     *
     * A hold made before signing in belongs to nobody — that is the point of the anonymous
     * hold, so a slot is not lost while someone goes to find their phone. Confirming it
     * without assigning an owner left a CONFIRMED booking with no account behind it: no
     * name, no number, nothing in the customer's own list, and nobody the counter could
     * ring about it. The payment path already claims the hold this way; this one did not,
     * and with no gateway this is now the only path there is.
     */
    const claim =
      booking.userId === null && actorId !== null ? { userId: actorId } : {};

    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'CONFIRMED', holdExpiresAt: null, ...claim },
      }),
      this.prisma.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: 'CONFIRMED',
          actorType: actorId === null ? 'SYSTEM' : 'CUSTOMER',
          actorId,
        },
      }),
    ]);

    return { checkinPayload: await this.checkin.issueToken(bookingId) };
  }

  /** Customer cancellation, subject to the store's cancellation window. */
  async cancelByCustomer(bookingId: string, userId: string, reason?: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: { store: { include: { settings: true } } },
    });
    if (booking === null) throw AppError.notFound('Booking');

    const windowMinutes = booking.store.settings?.cancellationWindowMinutes ?? 120;
    const cutoff = new Date(booking.startsAt.getTime() - windowMinutes * 60_000);

    if (new Date() > cutoff) {
      throw new AppError(
        'BOOKING_NOT_CANCELLABLE',
        409,
        'Too late to cancel',
        `Bookings can be cancelled up to ${windowMinutes} minutes before the slot.`,
        { cancellableUntil: cutoff.toISOString() },
      );
    }

    return this.transition(bookingId, 'CANCELLED', 'CUSTOMER', userId, reason);
  }

  /**
   * Admin-driven transition. Validated against the same table as everything else, so a
   * mis-tapped button on the counter tablet cannot put a booking into an impossible state.
   */
  async transition(
    bookingId: string,
    to: BookingStatus,
    actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM',
    actorId: string | null,
    reason?: string,
  ) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

    if (booking.status === to) return { status: to, changed: false };

    if (!canTransition(booking.status, to)) {
      throw AppError.validation(
        `Cannot move a booking from ${booking.status} to ${to}.`,
        { from: booking.status, to, allowed: ALLOWED_TRANSITIONS[booking.status] },
      );
    }

    const now = new Date();
    const data: Prisma.BookingUpdateInput = { status: to };
    if (to === 'CANCELLED') {
      data.cancelledAt = now;
      data.cancelReason = reason ?? null;
    }
    if (to === 'CHECKED_IN') data.checkedInAt = now;
    if (to === 'COMPLETED') data.completedAt = now;

    await this.prisma.$transaction([
      this.prisma.booking.update({ where: { id: bookingId }, data }),
      this.prisma.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: to,
          actorType,
          actorId,
          reason: reason ?? null,
        },
      }),
    ]);

    this.logger.log(`${booking.publicId}: ${booking.status} → ${to}`);

    // A reward reserved by a booking that never happened goes back to the wallet. Doing it
    // here covers every cancellation path — customer, admin and system — rather than only
    // the one that happened to be written first.
    if (to === 'CANCELLED' || to === 'EXPIRED') {
      await this.rewards.release(bookingId);
    }

    if (to === 'CANCELLED' && booking.userId !== null) {
      await this.notifications.notifyBookingCancelled(bookingId);
    }

    return { status: to, changed: true };
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  async listForUser(params: {
    userId: string;
    status?: 'upcoming' | 'completed' | 'cancelled';
    limit: number;
    cursor?: string;
  }) {
    const now = new Date();

    const where: Prisma.BookingWhereInput = {
      userId: params.userId,
      ...(params.status === 'upcoming'
        ? { status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] }, startsAt: { gte: now } }
        : params.status === 'completed'
          ? { status: { in: ['COMPLETED', 'CHECKED_IN'] }, startsAt: { lt: now } }
          : params.status === 'cancelled'
            ? { status: { in: ['CANCELLED', 'NO_SHOW', 'EXPIRED'] } }
            : // Held bookings are an implementation detail of the checkout flow and would
              // only confuse the history screen.
              { status: { not: 'HELD' } }),
    };

    const rows = await this.prisma.booking.findMany({
      where,
      orderBy: { startsAt: params.status === 'upcoming' ? 'asc' : 'desc' },
      take: params.limit + 1,
      ...(params.cursor === undefined ? {} : { cursor: { id: params.cursor }, skip: 1 }),
      include: {
        addons: true,
        store: { select: { timezone: true, settings: { select: { cancellationWindowMinutes: true } } } },
      },
    });

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    return {
      data: page.map((b) => this.toSummary(b)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async detailForUser(bookingId: string, userId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: {
        addons: true,
        store: { select: { timezone: true, settings: { select: { cancellationWindowMinutes: true } } } },
      },
    });
    if (booking === null) throw AppError.notFound('Booking');

    const zone = booking.store.timezone;

    return {
      ...this.toSummary(booking),
      source: booking.source,
      pricing: {
        basePricePaise: booking.basePricePaise,
        addonsPricePaise: booking.addonsPricePaise,
        discountPaise: booking.discountPaise,
        payablePaise: booking.payablePaise,
      },
      checkinPayload:
        booking.status === 'CONFIRMED' || booking.status === 'CHECKED_IN'
          ? await this.checkin.payloadFor(booking.id)
          : null,
      checkedInAt: booking.checkedInAt === null ? null : toIso(booking.checkedInAt.getTime(), zone),
      cancelledAt: booking.cancelledAt === null ? null : toIso(booking.cancelledAt.getTime(), zone),
      createdAt: toIso(booking.createdAt.getTime(), zone),
    };
  }

  private toSummary(
    booking: Prisma.BookingGetPayload<{
      include: {
        addons: true;
        store: { select: { timezone: true; settings: { select: { cancellationWindowMinutes: true } } } };
      };
    }>,
  ) {
    const zone = booking.store.timezone;
    const windowMinutes = booking.store.settings?.cancellationWindowMinutes ?? 120;
    const cutoff = booking.startsAt.getTime() - windowMinutes * 60_000;

    return {
      id: booking.id,
      publicId: booking.publicId,
      status: booking.status,
      serviceName: booking.serviceNameSnapshot,
      startsAt: toIso(booking.startsAt.getTime(), zone),
      endsAt: toIso(booking.endsAt.getTime(), zone),
      durationMinutes: booking.totalDurationMinutes,
      payablePaise: booking.payablePaise,
      addons: booking.addons.map((a) => ({ name: a.nameSnapshot, pricePaise: a.pricePaise })),
      canCancel: booking.status === 'CONFIRMED' && Date.now() < cutoff,
    };
  }

  // ── Admin views ────────────────────────────────────────────────────────────

  /**
   * Station-wise day timeline — the view counter staff actually live in.
   *
   * Returns the buffer separately from the session so the admin UI can render it as its own
   * band. When the owner asks "why can't I book 9:10 when the 9:00 ends at 9:10", that
   * rendering answers it without anyone having to explain buffers.
   */
  async timeline(storeId: string, date: string) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const dayStart = DateTime.fromISO(date, { zone: store.timezone }).startOf('day');
    if (!dayStart.isValid) throw AppError.validation(`"${date}" is not a valid date.`);
    const dayEnd = dayStart.plus({ days: 1 });

    const [stations, bookings, blackouts] = await Promise.all([
      this.prisma.station.findMany({
        where: { storeId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.booking.findMany({
        where: {
          storeId,
          status: { in: ['HELD', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'] },
          startsAt: { gte: dayStart.toJSDate(), lt: dayEnd.toJSDate() },
        },
        orderBy: { startsAt: 'asc' },
        include: {
          user: { select: { name: true, phone: true } },
          // With no gateway every booking arrives unpaid, so whether one has been settled
          // is what the counter is scanning the timeline for.
          payments: { where: { status: 'CAPTURED' }, select: { id: true, method: true } },
        },
      }),
      this.prisma.blackout.findMany({
        where: {
          storeId,
          startsAt: { lt: dayEnd.toJSDate() },
          endsAt: { gt: dayStart.toJSDate() },
        },
      }),
    ]);

    const zone = store.timezone;

    return {
      date,
      timezone: zone,
      stations: stations.map((station) => ({
        id: station.id,
        name: station.name,
        bookings: bookings
          .filter((b) => b.stationId === station.id)
          .map((b) => ({
            id: b.id,
            publicId: b.publicId,
            status: b.status,
            source: b.source,
            // Distinguish by whether there is an account at all, not by whether a name was
            // saved. A signed-in customer who never filled in their name is a guest, not a
            // walk-in, and labelling them "Walk-in" misleads whoever is at the counter.
            customerName:
              b.user === null
                ? 'Walk-in'
                : (b.user.name ??
                  // Google sign-in gives an email and no phone, so the last-four fallback
                  // is no longer always available. A bare "Guest" is fine — the counter has
                  // the booking code and the service beside it.
                  (b.user.phone === null ? 'Guest' : `Guest ${b.user.phone.slice(-4)}`)),
            customerPhone: b.user?.phone ?? null,
            serviceName: b.serviceNameSnapshot,
            startsAt: toIso(b.startsAt.getTime(), zone),
            endsAt: toIso(b.endsAt.getTime(), zone),
            // Rendered as its own visual band in the admin timeline.
            bufferEndsAt: toIso(b.blockedUntil.getTime(), zone),
            payablePaise: b.payablePaise,
            isPaid: b.payments.length > 0,
            paidMethod: b.payments[0]?.method ?? null,
          })),
        blackouts: blackouts
          .filter((x) => x.stationId === null || x.stationId === station.id)
          .map((x) => ({
            startsAt: toIso(x.startsAt.getTime(), zone),
            endsAt: toIso(x.endsAt.getTime(), zone),
            reason: x.reason,
          })),
      })),
    };
  }
}
