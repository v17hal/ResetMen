import { Injectable } from '@nestjs/common';
import type { BookingStatus } from '@prisma/client';
import { DateTime, Interval } from 'luxon';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Bookings that represent money earned and a station actually occupied.
 *
 * CONFIRMED is deliberately excluded from realised revenue: it is money taken for a visit
 * that has not happened yet. Counting it would make today's revenue figure move backwards
 * whenever someone fails to turn up, and a report that revises itself downwards is a report
 * nobody trusts.
 */
const REALISED: readonly BookingStatus[] = ['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'];

/** Occupies a station, whether or not anyone turned up. */
const OCCUPYING: readonly BookingStatus[] = [
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'NO_SHOW',
];

interface Range {
  readonly from: string;
  readonly to: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves an inclusive store-local date range to UTC instants.
   *
   * "1st to 7th" means seven whole days in the store's timezone — which is not the same as
   * seven days in UTC, and getting it wrong shifts five and a half hours of every Indian
   * evening into the wrong day.
   */
  private async window(storeId: string, range: Range) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: { settings: { select: { currency: true } } },
    });
    if (store === null) throw AppError.notFound('Store');

    const start = DateTime.fromISO(range.from, { zone: store.timezone }).startOf('day');
    const end = DateTime.fromISO(range.to, { zone: store.timezone }).endOf('day');

    if (!start.isValid || !end.isValid) {
      throw AppError.validation('Invalid date range.');
    }
    if (end.diff(start, 'days').days > 400) {
      throw AppError.validation('Reports cover at most 400 days at a time.');
    }

    return {
      store,
      zone: store.timezone,
      currency: store.settings?.currency ?? 'INR',
      startJs: start.toJSDate(),
      endJs: end.toJSDate(),
      start,
      end,
    };
  }

  async revenue(storeId: string, range: Range) {
    const w = await this.window(storeId, range);

    const bookings = await this.prisma.booking.findMany({
      where: {
        storeId,
        status: { in: [...REALISED] },
        startsAt: { gte: w.startJs, lte: w.endJs },
      },
      select: {
        serviceId: true,
        serviceNameSnapshot: true,
        basePricePaise: true,
        addonsPricePaise: true,
        discountPaise: true,
        payablePaise: true,
        startsAt: true,
      },
    });

    const refunds = await this.prisma.refund.aggregate({
      where: {
        status: { in: ['PROCESSED', 'PENDING'] },
        payment: { storeId, createdAt: { gte: w.startJs, lte: w.endJs } },
      },
      _sum: { amountPaise: true },
    });

    const grossPaise = bookings.reduce((s, b) => s + b.basePricePaise + b.addonsPricePaise, 0);
    const discountPaise = bookings.reduce((s, b) => s + b.discountPaise, 0);
    const netPaise = bookings.reduce((s, b) => s + b.payablePaise, 0);

    const byDay = new Map<string, { netPaise: number; bookingCount: number }>();
    const byService = new Map<string, { serviceId: string | null; serviceName: string; bookingCount: number; netPaise: number }>();

    for (const booking of bookings) {
      const day = DateTime.fromJSDate(booking.startsAt).setZone(w.zone).toISODate() ?? range.from;
      const dayEntry = byDay.get(day) ?? { netPaise: 0, bookingCount: 0 };
      dayEntry.netPaise += booking.payablePaise;
      dayEntry.bookingCount += 1;
      byDay.set(day, dayEntry);

      const key = booking.serviceId;
      const serviceEntry = byService.get(key) ?? {
        serviceId: booking.serviceId,
        // The snapshot, not the current name: a service renamed last week should not
        // rewrite what the report said about the week before.
        serviceName: booking.serviceNameSnapshot,
        bookingCount: 0,
        netPaise: 0,
      };
      serviceEntry.bookingCount += 1;
      serviceEntry.netPaise += booking.payablePaise;
      byService.set(key, serviceEntry);
    }

    return {
      from: range.from,
      to: range.to,
      currency: w.currency,
      grossPaise,
      discountPaise,
      netPaise,
      refundedPaise: refunds._sum.amountPaise ?? 0,
      bookingCount: bookings.length,
      averageOrderPaise: bookings.length === 0 ? 0 : Math.round(netPaise / bookings.length),
      byDay: [...byDay.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      byService: [...byService.values()].sort((a, b) => b.netPaise - a.netPaise),
    };
  }

  /**
   * Station utilisation.
   *
   * Buffer time is reported separately from booked time rather than folded into it. It is
   * the number the owner will challenge — "why is utilisation only 70%?" — and showing the
   * cleaning time explicitly answers that without an argument.
   */
  async utilisation(storeId: string, range: Range) {
    const w = await this.window(storeId, range);

    const [stations, hours, bookings, blackouts] = await Promise.all([
      this.prisma.station.findMany({
        where: { storeId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.storeHour.findMany({ where: { storeId } }),
      this.prisma.booking.findMany({
        where: {
          storeId,
          status: { in: [...OCCUPYING] },
          startsAt: { gte: w.startJs, lte: w.endJs },
        },
        select: { stationId: true, startsAt: true, endsAt: true, blockedUntil: true },
      }),
      this.prisma.blackout.findMany({
        where: { storeId, startsAt: { lt: w.endJs }, endsAt: { gt: w.startJs } },
        select: { stationId: true, startsAt: true, endsAt: true },
      }),
    ]);

    const hoursByDay = new Map(hours.map((h) => [h.dayOfWeek, h]));

    // Open minutes per station per day, from the store's weekly hours.
    let openMinutesPerStation = 0;
    for (let day = w.start; day < w.end; day = day.plus({ days: 1 })) {
      // Luxon weekday is 1=Monday…7=Sunday; the schema uses 0=Sunday…6=Saturday.
      const hour = hoursByDay.get(day.weekday % 7);
      if (hour === undefined || hour.isClosed) continue;

      openMinutesPerStation +=
        minutesOfDay(hour.closesAt) - minutesOfDay(hour.opensAt);
    }

    const perStation = stations.map((station) => {
      const own = bookings.filter((b) => b.stationId === station.id);

      const bookedMinutes = own.reduce(
        (sum, b) => sum + diffMinutes(b.startsAt, b.endsAt),
        0,
      );
      const bufferMinutes = own.reduce(
        (sum, b) => sum + diffMinutes(b.endsAt, b.blockedUntil),
        0,
      );

      // A blacked-out station was not available, so counting that time as idle capacity
      // would make a broken chair look like a sales problem.
      const blackedOut = blackouts
        .filter((x) => x.stationId === null || x.stationId === station.id)
        .reduce((sum, x) => sum + overlapMinutes(x, w.startJs, w.endJs), 0);

      const openMinutes = Math.max(0, openMinutesPerStation - blackedOut);

      return {
        stationId: station.id,
        stationName: station.name,
        openMinutes,
        bookedMinutes,
        bufferMinutes,
        utilisationPercent: percent(bookedMinutes, openMinutes),
        sessionCount: own.length,
      };
    });

    const totals = perStation.reduce(
      (acc, s) => ({
        openMinutes: acc.openMinutes + s.openMinutes,
        bookedMinutes: acc.bookedMinutes + s.bookedMinutes,
        bufferMinutes: acc.bufferMinutes + s.bufferMinutes,
      }),
      { openMinutes: 0, bookedMinutes: 0, bufferMinutes: 0 },
    );

    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, sessionCount: 0 }));
    for (const booking of bookings) {
      const hour = DateTime.fromJSDate(booking.startsAt).setZone(w.zone).hour;
      const entry = byHour[hour];
      if (entry !== undefined) entry.sessionCount += 1;
    }

    return {
      from: range.from,
      to: range.to,
      ...totals,
      utilisationPercent: percent(totals.bookedMinutes, totals.openMinutes),
      byStation: perStation,
      byHour: byHour.filter((h) => h.sessionCount > 0),
    };
  }

  /**
   * No-shows.
   *
   * `forfeitedRevenuePaise` is the number that answers "should we take a deposit?" — it is
   * money already collected for sessions nobody attended, and it is the only honest way to
   * size that decision.
   */
  async noShow(storeId: string, range: Range) {
    const w = await this.window(storeId, range);
    const where = { storeId, startsAt: { gte: w.startJs, lte: w.endJs } };

    const [confirmed, noShows, cancelled, forfeited, offenders] = await Promise.all([
      this.prisma.booking.count({
        where: { ...where, status: { in: ['CONFIRMED', ...REALISED, 'NO_SHOW'] } },
      }),
      this.prisma.booking.count({ where: { ...where, status: 'NO_SHOW' } }),
      this.prisma.booking.count({ where: { ...where, status: 'CANCELLED' } }),
      this.prisma.booking.aggregate({
        where: { ...where, status: 'NO_SHOW' },
        _sum: { payablePaise: true },
      }),
      this.prisma.booking.groupBy({
        by: ['userId'],
        where: { ...where, status: 'NO_SHOW', userId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { userId: 'desc' } },
        take: 10,
      }),
    ]);

    const users =
      offenders.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: offenders.map((o) => o.userId!).filter(Boolean) } },
            select: { id: true, name: true, phone: true },
          });
    const byId = new Map(users.map((u) => [u.id, u]));

    return {
      from: range.from,
      to: range.to,
      confirmedCount: confirmed,
      noShowCount: noShows,
      cancelledCount: cancelled,
      noShowPercent: percent(noShows, confirmed),
      forfeitedRevenuePaise: forfeited._sum.payablePaise ?? 0,
      repeatOffenders: offenders
        .filter((o) => o.userId !== null && (o._count._all ?? 0) > 1)
        .map((o) => ({
          userId: o.userId!,
          name: byId.get(o.userId!)?.name ?? null,
          phone: byId.get(o.userId!)?.phone ?? '',
          noShowCount: o._count._all,
        })),
    };
  }

  /** New versus repeat, and whether the loyalty machinery is doing anything. */
  async retention(storeId: string, range: Range) {
    const w = await this.window(storeId, range);

    const visitors = await this.prisma.booking.groupBy({
      by: ['userId'],
      where: {
        storeId,
        status: { in: [...REALISED] },
        startsAt: { gte: w.startJs, lte: w.endJs },
        userId: { not: null },
      },
      _count: { _all: true },
    });

    const userIds = visitors.map((v) => v.userId!).filter(Boolean);

    // "New" means their first realised visit ever fell inside the window — not that their
    // account was created in it. Someone who signed up in March and first came in June is
    // a new customer in June, which is when the store actually acquired them.
    const priorVisits =
      userIds.length === 0
        ? []
        : await this.prisma.booking.groupBy({
            by: ['userId'],
            where: {
              storeId,
              status: { in: [...REALISED] },
              startsAt: { lt: w.startJs },
              userId: { in: userIds },
            },
            _count: { _all: true },
          });

    const returning = new Set(priorVisits.map((p) => p.userId));
    const newCustomers = userIds.filter((id) => !returning.has(id)).length;
    const repeatCustomers = userIds.length - newCustomers;
    const totalVisits = visitors.reduce((sum, v) => sum + v._count._all, 0);

    const [activeStreaks, issued, redeemed] = await Promise.all([
      this.prisma.userStreak.count({ where: { storeId, currentCount: { gt: 0 } } }),
      this.prisma.userReward.count({
        where: { storeId, createdAt: { gte: w.startJs, lte: w.endJs } },
      }),
      this.prisma.userReward.count({
        where: { storeId, status: 'REDEEMED', updatedAt: { gte: w.startJs, lte: w.endJs } },
      }),
    ]);

    return {
      from: range.from,
      to: range.to,
      newCustomers,
      repeatCustomers,
      repeatPercent: percent(repeatCustomers, userIds.length),
      averageVisitsPerCustomer:
        userIds.length === 0 ? 0 : Number((totalVisits / userIds.length).toFixed(2)),
      activeStreaks,
      rewardsIssued: issued,
      rewardsRedeemed: redeemed,
    };
  }

  /**
   * CSV export.
   *
   * Written by hand rather than with a library because the requirement is small and the
   * escaping rule is one line — but that one line matters: a service called
   * `Head Reset, 30 min` would otherwise split into two columns and silently corrupt the
   * spreadsheet the owner is about to make decisions from.
   */
  async csv(storeId: string, range: Range, report: string): Promise<{ filename: string; body: string }> {
    const w = await this.window(storeId, range);

    if (report === 'bookings') {
      const bookings = await this.prisma.booking.findMany({
        where: { storeId, startsAt: { gte: w.startJs, lte: w.endJs } },
        orderBy: { startsAt: 'asc' },
        include: {
          user: { select: { name: true, phone: true } },
          station: { select: { name: true } },
        },
      });

      const rows = bookings.map((b) => [
        b.publicId,
        DateTime.fromJSDate(b.startsAt).setZone(w.zone).toFormat('yyyy-LL-dd HH:mm'),
        b.serviceNameSnapshot,
        b.station.name,
        b.user?.name ?? 'Walk-in',
        b.user?.phone ?? '',
        b.status,
        b.source,
        (b.basePricePaise / 100).toFixed(2),
        (b.addonsPricePaise / 100).toFixed(2),
        (b.discountPaise / 100).toFixed(2),
        (b.payablePaise / 100).toFixed(2),
      ]);

      return {
        filename: `reset-bookings-${range.from}-to-${range.to}.csv`,
        body: toCsv(
          ['Booking', 'Starts', 'Service', 'Station', 'Customer', 'Phone', 'Status', 'Source',
            'Base', 'Add-ons', 'Discount', 'Paid'],
          rows,
        ),
      };
    }

    if (report === 'revenue') {
      const data = await this.revenue(storeId, range);
      return {
        filename: `reset-revenue-${range.from}-to-${range.to}.csv`,
        body: toCsv(
          ['Date', 'Bookings', 'Net'],
          data.byDay.map((d) => [d.date, String(d.bookingCount), (d.netPaise / 100).toFixed(2)]),
        ),
      };
    }

    if (report === 'utilisation') {
      const data = await this.utilisation(storeId, range);
      return {
        filename: `reset-utilisation-${range.from}-to-${range.to}.csv`,
        body: toCsv(
          ['Station', 'Open minutes', 'Booked minutes', 'Buffer minutes', 'Sessions', 'Utilisation %'],
          data.byStation.map((s) => [
            s.stationName,
            String(s.openMinutes),
            String(s.bookedMinutes),
            String(s.bufferMinutes),
            String(s.sessionCount),
            String(s.utilisationPercent),
          ]),
        ),
      };
    }

    if (report === 'no-show') {
      const data = await this.noShow(storeId, range);
      return {
        filename: `reset-no-shows-${range.from}-to-${range.to}.csv`,
        body: toCsv(
          ['Customer', 'Phone', 'No-shows'],
          data.repeatOffenders.map((o) => [o.name ?? '', o.phone, String(o.noShowCount)]),
        ),
      };
    }

    const data = await this.retention(storeId, range);
    return {
      filename: `reset-retention-${range.from}-to-${range.to}.csv`,
      body: toCsv(
        ['Metric', 'Value'],
        [
          ['New customers', String(data.newCustomers)],
          ['Repeat customers', String(data.repeatCustomers)],
          ['Repeat %', String(data.repeatPercent)],
          ['Average visits per customer', String(data.averageVisitsPerCustomer)],
          ['Active streaks', String(data.activeStreaks)],
          ['Rewards issued', String(data.rewardsIssued)],
          ['Rewards redeemed', String(data.rewardsRedeemed)],
        ],
      ),
    };
  }

  /** The counter's opening screen: today, at a glance. */
  async dashboard(storeId: string) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const today = DateTime.now().setZone(store.timezone);
    const range = { from: today.toISODate()!, to: today.toISODate()! };

    const [revenue, utilisation, upcoming, unscratched] = await Promise.all([
      this.revenue(storeId, range),
      this.utilisation(storeId, range),
      this.prisma.booking.count({
        where: { storeId, status: 'CONFIRMED', startsAt: { gte: new Date() } },
      }),
      this.prisma.scratchCard.count({ where: { status: 'ISSUED', campaign: { storeId } } }),
    ]);

    return {
      date: range.from,
      revenueTodayPaise: revenue.netPaise,
      sessionsToday: revenue.bookingCount,
      utilisationPercent: utilisation.utilisationPercent,
      upcomingConfirmed: upcoming,
      unscratchedCards: unscratched,
    };
  }
}

function minutesOfDay(time: Date): number {
  // `@db.Time` values come back as a Date on 1970-01-01 in UTC; only the clock part is real.
  return time.getUTCHours() * 60 + time.getUTCMinutes();
}

function diffMinutes(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

function overlapMinutes(span: { startsAt: Date; endsAt: Date }, from: Date, to: Date): number {
  const overlap = Interval.fromDateTimes(span.startsAt, span.endsAt).intersection(
    Interval.fromDateTimes(from, to),
  );
  return overlap === null ? 0 : Math.round(overlap.length('minutes'));
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Number(((part / whole) * 100).toFixed(1));
}

function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const escape = (value: string): string =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
}
