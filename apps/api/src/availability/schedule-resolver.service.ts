import { Injectable } from '@nestjs/common';
import type {
  AddonOption,
  AllocationRule,
  Prisma,
  Service,
  Station,
  Store,
  StoreSettings,
} from '@prisma/client';
import type {
  AvailabilityInput,
  BlackoutInterval,
  BusyInterval,
  Interval,
  ResolvedAllocationRule,
  StationInput,
} from '@reset/slot-engine-core';
import { DateTime } from 'luxon';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';

/** Booking statuses that occupy a station. Everything else releases it. */
export const OCCUPYING_STATUSES = [
  'HELD',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
] as const;

export interface ResolveOptions {
  readonly storeId: string;
  readonly serviceId: string;
  /** `YYYY-MM-DD` in store-local time. */
  readonly localDate: string;
  readonly addonOptionIds: readonly string[];
  /** Overridden in tests; defaults to the database clock. */
  readonly now?: Date;
  /**
   * The transaction to read within.
   *
   * Required when resolving inside `booking.hold` — for two reasons, both of which bit us
   * in the concurrency test before this existed:
   *
   *  1. **Correctness.** The hold transaction sweeps expired holds and then recomputes
   *     availability. Reading on a separate connection would not see that sweep, so a slot
   *     freed a millisecond earlier would still look occupied.
   *
   *  2. **Connection pressure.** A transaction already holds one pooled connection. If the
   *     resolver grabs a second, every concurrent hold needs two, and the pool is exhausted
   *     at roughly half the concurrency you would expect — at which point *every* attempt
   *     times out and nobody books anything.
   */
  readonly tx?: Prisma.TransactionClient;
  /**
   * A booking to treat as if it were not there.
   *
   * Set when rescheduling: the booking being moved still occupies its old station, and
   * without this it competes with itself. Moving a session ten minutes later would collide
   * with its own trailing buffer and report the slot as taken.
   */
  readonly excludeBookingId?: string;
}

export interface ResolvedSchedule {
  readonly input: AvailabilityInput;
  readonly store: Store & { settings: StoreSettings | null };
  readonly service: Service;
  readonly addons: readonly AddonOption[];
}

/**
 * Turns database rows into the engine's pure input.
 *
 * All timezone arithmetic happens here and nowhere else. The engine itself works purely in
 * epoch milliseconds, which is what keeps it free of a date library and exhaustively
 * testable — see `packages/slot-engine-core`.
 */
@Injectable()
export class ScheduleResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(options: ResolveOptions): Promise<ResolvedSchedule> {
    const db: Prisma.TransactionClient = options.tx ?? this.prisma;

    const store = await db.store.findUnique({
      where: { id: options.storeId },
      include: { settings: true },
    });
    if (store === null) throw AppError.notFound('Store');
    if (store.settings === null) throw AppError.notFound('Store settings');

    const service = await db.service.findFirst({
      where: { id: options.serviceId, storeId: store.id, deletedAt: null },
    });
    if (service === null) throw AppError.notFound('Service');

    const addons =
      options.addonOptionIds.length === 0
        ? []
        : await db.addonOption.findMany({
            where: { id: { in: [...options.addonOptionIds] }, isActive: true },
          });

    if (addons.length !== options.addonOptionIds.length) {
      throw AppError.validation('One or more selected add-ons no longer exist.');
    }

    const zone = store.timezone;
    const day = DateTime.fromISO(options.localDate, { zone });
    if (!day.isValid) {
      throw AppError.validation(`"${options.localDate}" is not a valid date.`);
    }

    const dayStart = day.startOf('day');
    const dayEnd = dayStart.plus({ days: 1 });
    const dayOfWeek = day.weekday === 7 ? 0 : day.weekday; // Prisma: 0=Sun … 6=Sat

    const [openWindows, stations, blackouts, busy, allocationRules] = await Promise.all([
      this.resolveOpenWindows(db, store.id, dayOfWeek, dayStart),
      this.resolveStations(db, store.id),
      this.resolveBlackouts(db, store.id, dayStart, dayEnd),
      this.resolveBusy(db, store.id, dayStart, dayEnd, options.excludeBookingId),
      this.resolveAllocationRules(db, store.id, dayOfWeek, dayStart),
    ]);

    const input: AvailabilityInput = {
      now: (options.now ?? new Date()).getTime(),
      service: {
        id: service.id,
        durationMinutes: service.durationMinutes,
        bufferOverrideMinutes: service.bufferOverrideMinutes,
      },
      addons: addons.map((a) => ({ durationDeltaMinutes: a.durationDeltaMinutes })),
      stations,
      openWindows,
      blackouts,
      busy,
      allocationRules,
      settings: {
        bufferMinutes: store.settings.bufferMinutes,
        slotGranularityMinutes: store.settings.slotGranularityMinutes,
        minLeadMinutes: store.settings.minLeadMinutes,
      },
    };

    return { input, store, service, addons };
  }

  /**
   * Store hours for the weekday, resolved to absolute instants.
   *
   * Multiple rows per weekday are supported and become multiple windows — that is how a
   * lunch-break split is expressed, and the engine refuses to let a session straddle one.
   */
  private async resolveOpenWindows(
    db: Prisma.TransactionClient,
    storeId: string,
    dayOfWeek: number,
    dayStart: DateTime,
  ): Promise<Interval[]> {
    const hours = await db.storeHour.findMany({
      where: { storeId, dayOfWeek, isClosed: false },
      orderBy: { opensAt: 'asc' },
    });

    return hours.map((row) => ({
      start: applyTimeOfDay(dayStart, row.opensAt).toMillis(),
      end: applyTimeOfDay(dayStart, row.closesAt).toMillis(),
    }));
  }

  private async resolveStations(
    db: Prisma.TransactionClient,
    storeId: string,
  ): Promise<StationInput[]> {
    const stations = await db.station.findMany({
      where: { storeId, isActive: true },
      include: { stationServices: { select: { serviceId: true } } },
      orderBy: { sortOrder: 'asc' },
    });

    return stations.map((station: Station & { stationServices: { serviceId: string }[] }) => ({
      id: station.id,
      sortOrder: station.sortOrder,
      allowsAllServices: station.allowsAllServices,
      serviceIds: station.stationServices.map((s) => s.serviceId),
    }));
  }

  private async resolveBlackouts(
    db: Prisma.TransactionClient,
    storeId: string,
    dayStart: DateTime,
    dayEnd: DateTime,
  ): Promise<BlackoutInterval[]> {
    const rows = await db.blackout.findMany({
      where: {
        storeId,
        startsAt: { lt: dayEnd.toJSDate() },
        endsAt: { gt: dayStart.toJSDate() },
      },
    });

    return rows.map((row) => ({
      stationId: row.stationId,
      start: row.startsAt.getTime(),
      end: row.endsAt.getTime(),
    }));
  }

  /**
   * Bookings that occupy a station during the day.
   *
   * Expired holds are filtered out here as well as being swept by the scheduled job, so a
   * slot frees up the instant its TTL passes even if the sweep hasn't run yet.
   */
  private async resolveBusy(
    db: Prisma.TransactionClient,
    storeId: string,
    dayStart: DateTime,
    dayEnd: DateTime,
    excludeBookingId?: string,
  ): Promise<BusyInterval[]> {
    const now = new Date();

    const rows = await db.booking.findMany({
      where: {
        storeId,
        status: { in: [...OCCUPYING_STATUSES] },
        startsAt: { lt: dayEnd.toJSDate() },
        // blockedUntil, not endsAt — the trailing buffer occupies the station too.
        blockedUntil: { gt: dayStart.toJSDate() },
        NOT: { status: 'HELD', holdExpiresAt: { lt: now } },
        ...(excludeBookingId === undefined ? {} : { id: { not: excludeBookingId } }),
      },
      select: { stationId: true, startsAt: true, blockedUntil: true },
    });

    return rows.map((row) => ({
      stationId: row.stationId,
      start: row.startsAt.getTime(),
      blockedUntil: row.blockedUntil.getTime(),
    }));
  }

  /**
   * Allocation rules in force on this date, with their wall-clock windows resolved to
   * instants.
   *
   * Client requirement 02/08/2026 — the morning ₹199 push.
   */
  private async resolveAllocationRules(
    db: Prisma.TransactionClient,
    storeId: string,
    dayOfWeek: number,
    dayStart: DateTime,
  ): Promise<ResolvedAllocationRule[]> {
    const date = dayStart.toJSDate();

    const rules = await db.allocationRule.findMany({
      where: {
        storeId,
        isActive: true,
        AND: [
          { OR: [{ dateFrom: null }, { dateFrom: { lte: date } }] },
          { OR: [{ dateTo: null }, { dateTo: { gte: date } }] },
        ],
      },
      include: {
        stations: { select: { stationId: true } },
        services: { select: { serviceId: true } },
      },
    });

    return rules
      .filter((rule) => appliesOnDay(rule, dayOfWeek, dayStart))
      .map((rule) => ({
        id: rule.id,
        mode: rule.mode,
        priority: rule.priority,
        window: {
          start: applyTimeOfDay(dayStart, rule.startsAtLocal).toMillis(),
          end: applyTimeOfDay(dayStart, rule.endsAtLocal).toMillis(),
        },
        stationIds: rule.stations.map((s) => s.stationId),
        serviceIds: rule.services.map((s) => s.serviceId),
      }));
  }
}

type RuleWithDays = Pick<AllocationRule, 'recurrence' | 'daysOfWeek' | 'dateFrom'>;

function appliesOnDay(
  rule: RuleWithDays,
  dayOfWeek: number,
  dayStart: DateTime,
): boolean {
  if (rule.recurrence === 'WEEKLY') {
    return rule.daysOfWeek.includes(dayOfWeek);
  }

  // ONE_OFF: dateFrom is the single day it runs.
  if (rule.dateFrom === null) return false;
  return DateTime.fromJSDate(rule.dateFrom, { zone: 'utc' }).toISODate() === dayStart.toISODate();
}

/**
 * Postgres `time` columns come back as a Date pinned to 1970-01-01 with the time in UTC.
 * Lift just the hour/minute onto the store-local day.
 */
function applyTimeOfDay(dayStart: DateTime, time: Date): DateTime {
  return dayStart.set({
    hour: time.getUTCHours(),
    minute: time.getUTCMinutes(),
    second: 0,
    millisecond: 0,
  });
}

export type { Prisma };
