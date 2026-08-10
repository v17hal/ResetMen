import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { labelFor } from '../rewards/reward-math.js';

/** Statuses that represent a booking someone actually paid for and turned up to. */
const REALISED = ['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'] as const;

@Injectable()
export class AdminCustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Customer list with the numbers the counter actually asks for.
   *
   * Lifetime value counts realised visits only — not confirmed bookings. A customer with
   * six no-shows is worth nothing, and a list that says otherwise sends the store chasing
   * the wrong people.
   */
  async list(params: {
    storeId: string;
    q?: string;
    blocked?: boolean;
    limit: number;
    cursor?: string;
  }) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      bookings: { some: { storeId: params.storeId } },
      ...(params.blocked === undefined ? {} : { isBlocked: params.blocked }),
      ...(params.q === undefined || params.q.length === 0
        ? {}
        : {
            OR: [
              { name: { contains: params.q, mode: 'insensitive' } },
              { phone: { contains: params.q } },
            ],
          }),
    };

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: params.limit + 1,
      ...(params.cursor === undefined ? {} : { cursor: { id: params.cursor }, skip: 1 }),
      include: {
        streak: { select: { currentCount: true } },
        _count: { select: { bookings: true } },
      },
    });

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    const stats = await this.prisma.booking.groupBy({
      by: ['userId'],
      where: {
        storeId: params.storeId,
        userId: { in: page.map((u) => u.id) },
        status: { in: [...REALISED] },
      },
      _sum: { payablePaise: true },
      _count: { _all: true },
      _max: { startsAt: true },
    });

    const byUser = new Map(stats.map((s) => [s.userId, s]));

    return {
      data: page.map((user) => {
        const stat = byUser.get(user.id);
        return {
          id: user.id,
          phone: user.phone,
          name: user.name,
          gender: user.gender,
          isBlocked: user.isBlocked,
          totalBookings: user._count.bookings,
          completedVisits: stat?._count._all ?? 0,
          lifetimeValuePaise: stat?._sum.payablePaise ?? 0,
          lastVisitAt: stat?._max.startsAt?.toISOString() ?? null,
          currentStreak: user.streak?.currentCount ?? 0,
          createdAt: user.createdAt.toISOString(),
        };
      }),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /** Everything about one customer, for the panel staff open when the phone rings. */
  async detail(storeId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        streak: true,
        preferredSegment: { select: { name: true } },
      },
    });
    if (user === null) throw AppError.notFound('Customer');

    const [bookings, rewards, noShows, spend] = await Promise.all([
      this.prisma.booking.findMany({
        where: { userId, storeId },
        orderBy: { startsAt: 'desc' },
        take: 20,
        include: { addons: { select: { nameSnapshot: true } } },
      }),
      this.prisma.userReward.findMany({
        where: { userId, storeId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.booking.count({ where: { userId, storeId, status: 'NO_SHOW' } }),
      this.prisma.booking.aggregate({
        where: { userId, storeId, status: { in: [...REALISED] } },
        _sum: { payablePaise: true },
        _count: { _all: true },
      }),
    ]);

    return {
      id: user.id,
      phone: user.phone,
      name: user.name,
      email: user.email,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth?.toISOString() ?? null,
      preferredSegment: user.preferredSegment?.name ?? null,
      isBlocked: user.isBlocked,
      blockedReason: user.blockedReason,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      stats: {
        completedVisits: spend._count._all,
        lifetimeValuePaise: spend._sum.payablePaise ?? 0,
        noShowCount: noShows,
        currentStreak: user.streak?.currentCount ?? 0,
        bestStreak: user.streak?.bestCount ?? 0,
        totalVisits: user.streak?.totalVisits ?? 0,
      },
      bookings: bookings.map((b) => ({
        id: b.id,
        publicId: b.publicId,
        status: b.status,
        serviceName: b.serviceNameSnapshot,
        startsAt: b.startsAt.toISOString(),
        payablePaise: b.payablePaise,
        addons: b.addons.map((a) => a.nameSnapshot),
      })),
      rewards: rewards.map((r) => ({
        id: r.id,
        label: labelFor(r),
        source: r.source,
        status: r.status,
        validTill: r.validTill.toISOString(),
      })),
    };
  }

  /**
   * Blocks or unblocks.
   *
   * Blocking stops future bookings; it deliberately leaves existing ones alone. Cancelling
   * someone's Saturday appointment as a side effect of a note made on Tuesday is not a
   * decision this endpoint should make on the store's behalf.
   */
  async setBlocked(params: {
    storeId: string;
    userId: string;
    blocked: boolean;
    reason?: string;
  }) {
    const user = await this.prisma.user.findFirst({
      where: { id: params.userId, deletedAt: null },
    });
    if (user === null) throw AppError.notFound('Customer');

    const updated = await this.prisma.user.update({
      where: { id: params.userId },
      data: {
        isBlocked: params.blocked,
        blockedReason: params.blocked ? (params.reason ?? 'Blocked by store') : null,
      },
    });

    const upcoming = await this.prisma.booking.count({
      where: {
        userId: params.userId,
        storeId: params.storeId,
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        startsAt: { gte: new Date() },
      },
    });

    return {
      before: user,
      after: updated,
      // Surfaced so the admin UI can prompt: blocking someone with a booking tomorrow is
      // usually followed by wanting to cancel it.
      upcomingBookings: upcoming,
    };
  }
}
