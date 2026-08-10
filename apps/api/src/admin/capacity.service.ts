import { Injectable } from '@nestjs/common';
import { computeAvailability } from '@reset/slot-engine-core';
import type { ResolvedAllocationRule } from '@reset/slot-engine-core';
import type {
  AllocationRuleInput,
  BlackoutInput,
  StationInput,
  StationServices,
  StoreHourInput,
  StoreSettingsInput,
} from '@reset/types';
import { DateTime } from 'luxon';

import { ScheduleResolverService } from '../availability/schedule-resolver.service.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';

/** `09:00` → the Date shape Postgres `time` columns expect. */
function toTime(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

function fromTime(time: Date): string {
  return `${String(time.getUTCHours()).padStart(2, '0')}:${String(time.getUTCMinutes()).padStart(2, '0')}`;
}

@Injectable()
export class CapacityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ScheduleResolverService,
  ) {}

  // ── Stations ───────────────────────────────────────────────────────────────

  async listStations(storeId: string) {
    const stations = await this.prisma.station.findMany({
      where: { storeId },
      orderBy: { sortOrder: 'asc' },
      include: { stationServices: { select: { serviceId: true } } },
    });

    return stations.map((s) => ({
      id: s.id,
      name: s.name,
      isActive: s.isActive,
      sortOrder: s.sortOrder,
      allowsAllServices: s.allowsAllServices,
      serviceIds: s.stationServices.map((x) => x.serviceId),
    }));
  }

  async createStation(storeId: string, input: StationInput) {
    return this.prisma.station.create({ data: { storeId, ...input } });
  }

  async updateStation(storeId: string, stationId: string, input: Partial<StationInput>) {
    await this.assertStation(storeId, stationId);

    // Deactivating a station with live bookings would strand those customers silently.
    if (input.isActive === false) {
      const affected = await this.prisma.booking.count({
        where: {
          stationId,
          status: { in: ['HELD', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] },
          startsAt: { gte: new Date() },
        },
      });

      if (affected > 0) {
        throw AppError.validation(
          `This station has ${affected} upcoming booking(s). Reassign or cancel them before deactivating it.`,
          { affectedBookings: affected },
        );
      }
    }

    return this.prisma.station.update({ where: { id: stationId }, data: input });
  }

  /**
   * Station → service designation. Client requirement 02/08/2026:
   * "certain beds may be designated only for head massage based on space constraints".
   */
  async setStationServices(storeId: string, stationId: string, input: StationServices) {
    await this.assertStation(storeId, stationId);

    if (!input.allowsAllServices) {
      const valid = await this.prisma.service.count({
        where: { id: { in: input.serviceIds }, storeId, deletedAt: null },
      });
      if (valid !== input.serviceIds.length) {
        throw AppError.validation('One or more services do not belong to this store.');
      }
    }

    await this.prisma.$transaction([
      this.prisma.stationService.deleteMany({ where: { stationId } }),
      this.prisma.station.update({
        where: { id: stationId },
        data: { allowsAllServices: input.allowsAllServices },
      }),
      ...(input.allowsAllServices
        ? []
        : [
            this.prisma.stationService.createMany({
              data: input.serviceIds.map((serviceId) => ({ stationId, serviceId })),
            }),
          ]),
    ]);

    return this.coverageWarnings(storeId);
  }

  /**
   * Which services can no longer be booked anywhere, or only on a single station.
   *
   * Returned after every designation change so the owner sees the consequence immediately
   * rather than discovering it when a customer cannot book.
   */
  async coverageWarnings(storeId: string) {
    const [services, stations] = await Promise.all([
      this.prisma.service.findMany({
        where: { storeId, isActive: true, deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.station.findMany({
        where: { storeId, isActive: true },
        include: { stationServices: { select: { serviceId: true } } },
      }),
    ]);

    return services.map((service) => {
      const eligible = stations.filter(
        (station) =>
          station.allowsAllServices ||
          station.stationServices.some((x) => x.serviceId === service.id),
      );

      return {
        serviceId: service.id,
        serviceName: service.name,
        eligibleStations: eligible.length,
        totalStations: stations.length,
        warning:
          eligible.length === 0
            ? 'No station can host this service — it can never be booked.'
            : eligible.length === 1
              ? 'Only one station can host this service.'
              : null,
      };
    });
  }

  // ── Allocation rules ───────────────────────────────────────────────────────

  async listAllocationRules(storeId: string) {
    const rules = await this.prisma.allocationRule.findMany({
      where: { storeId },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      include: {
        stations: { include: { station: { select: { id: true, name: true } } } },
        services: { include: { service: { select: { id: true, name: true } } } },
      },
    });

    return rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      mode: rule.mode,
      recurrence: rule.recurrence,
      daysOfWeek: rule.daysOfWeek,
      dateFrom: rule.dateFrom,
      dateTo: rule.dateTo,
      startsAtLocal: fromTime(rule.startsAtLocal),
      endsAtLocal: fromTime(rule.endsAtLocal),
      priority: rule.priority,
      isActive: rule.isActive,
      stations: rule.stations.map((s) => s.station),
      services: rule.services.map((s) => s.service),
    }));
  }

  async createAllocationRule(storeId: string, input: AllocationRuleInput) {
    await this.assertRuleReferences(storeId, input);

    return this.prisma.allocationRule.create({
      data: {
        storeId,
        name: input.name,
        mode: input.mode,
        recurrence: input.recurrence,
        daysOfWeek: input.daysOfWeek,
        dateFrom: input.dateFrom === null ? null : new Date(input.dateFrom),
        dateTo: input.dateTo === null ? null : new Date(input.dateTo),
        startsAtLocal: toTime(input.startsAtLocal),
        endsAtLocal: toTime(input.endsAtLocal),
        priority: input.priority,
        isActive: input.isActive,
        stations: { create: input.stationIds.map((stationId) => ({ stationId })) },
        services: { create: input.serviceIds.map((serviceId) => ({ serviceId })) },
      },
    });
  }

  async updateAllocationRule(storeId: string, ruleId: string, input: AllocationRuleInput) {
    await this.assertRule(storeId, ruleId);
    await this.assertRuleReferences(storeId, input);

    return this.prisma.$transaction(async (tx) => {
      await tx.allocationRuleStation.deleteMany({ where: { ruleId } });
      await tx.allocationRuleService.deleteMany({ where: { ruleId } });

      return tx.allocationRule.update({
        where: { id: ruleId },
        data: {
          name: input.name,
          mode: input.mode,
          recurrence: input.recurrence,
          daysOfWeek: input.daysOfWeek,
          dateFrom: input.dateFrom === null ? null : new Date(input.dateFrom),
          dateTo: input.dateTo === null ? null : new Date(input.dateTo),
          startsAtLocal: toTime(input.startsAtLocal),
          endsAtLocal: toTime(input.endsAtLocal),
          priority: input.priority,
          isActive: input.isActive,
          stations: { create: input.stationIds.map((stationId) => ({ stationId })) },
          services: { create: input.serviceIds.map((serviceId) => ({ serviceId })) },
        },
      });
    });
  }

  async deleteAllocationRule(storeId: string, ruleId: string) {
    await this.assertRule(storeId, ruleId);
    await this.prisma.allocationRule.delete({ where: { id: ruleId } });
    return { deleted: true };
  }

  /**
   * Dry-run: what would this rule do to a given day, and which existing bookings would it
   * strand?
   *
   * This is the most valuable endpoint in the admin panel. Reserving two stations for a
   * ₹199 morning push can quietly eliminate all morning availability for the ₹299 Premium —
   * the opposite of what the owner intended. Showing the before/after per service, plus the
   * bookings that would conflict, turns a risky action into an informed one.
   */
  async previewAllocationRule(
    storeId: string,
    input: AllocationRuleInput,
    date: string,
    excludeRuleId?: string,
  ) {
    await this.assertRuleReferences(storeId, input);

    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const dayStart = DateTime.fromISO(date, { zone: store.timezone }).startOf('day');
    if (!dayStart.isValid) throw AppError.validation(`"${date}" is not a valid date.`);

    const services = await this.prisma.service.findMany({
      where: { storeId, isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });

    const windowStart = applyTime(dayStart, input.startsAtLocal);
    const windowEnd = applyTime(dayStart, input.endsAtLocal);

    const candidate: ResolvedAllocationRule = {
      id: '__preview__',
      mode: input.mode,
      priority: input.priority,
      window: { start: windowStart.toMillis(), end: windowEnd.toMillis() },
      stationIds: input.stationIds,
      serviceIds: input.serviceIds,
    };

    const effects = [];
    for (const service of services) {
      const { input: resolved } = await this.resolver.resolve({
        storeId,
        serviceId: service.id,
        localDate: date,
        addonOptionIds: [],
      });

      // Drop the rule being edited from the "before" picture, otherwise editing a rule
      // compares it against itself and every effect reads as "no change".
      const existing = resolved.allocationRules.filter((r) => r.id !== excludeRuleId);

      const before = computeAvailability({ ...resolved, allocationRules: existing });
      const after = computeAvailability({
        ...resolved,
        allocationRules: [...existing, candidate],
      });

      const inWindow = (slots: readonly { startsAt: number; stationsAvailable: number }[]) =>
        slots.filter(
          (s) => s.startsAt >= windowStart.toMillis() && s.startsAt < windowEnd.toMillis(),
        );

      const beforeWindow = inWindow(before.slots);
      const afterWindow = inWindow(after.slots);

      effects.push({
        serviceId: service.id,
        serviceName: service.name,
        slotsBefore: before.slots.length,
        slotsAfter: after.slots.length,
        stationsBeforeInWindow: Math.max(
          0,
          ...beforeWindow.map((s) => s.stationsAvailable),
          0,
        ),
        stationsAfterInWindow: Math.max(0, ...afterWindow.map((s) => s.stationsAvailable), 0),
      });
    }

    return {
      date,
      effects,
      conflicts: await this.findConflicts(storeId, input, windowStart, windowEnd),
    };
  }

  /** Existing bookings the rule would forbid if it were already in force. */
  private async findConflicts(
    storeId: string,
    input: AllocationRuleInput,
    windowStart: DateTime,
    windowEnd: DateTime,
  ) {
    const bookings = await this.prisma.booking.findMany({
      where: {
        storeId,
        stationId: { in: input.stationIds },
        status: { in: ['HELD', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] },
        startsAt: { lt: windowEnd.toJSDate() },
        endsAt: { gt: windowStart.toJSDate() },
      },
      include: { station: { select: { name: true } } },
    });

    const listed = new Set(input.serviceIds);

    return bookings
      .filter((b) =>
        input.mode === 'EXCLUSIVE_TO' ? !listed.has(b.serviceId) : listed.has(b.serviceId),
      )
      .map((b) => ({
        bookingId: b.id,
        publicId: b.publicId,
        serviceName: b.serviceNameSnapshot,
        stationName: b.station.name,
        startsAt: b.startsAt.toISOString(),
      }));
  }

  // ── Hours, blackouts, settings ─────────────────────────────────────────────

  async setStoreHours(storeId: string, hours: StoreHourInput[]) {
    await this.prisma.$transaction([
      this.prisma.storeHour.deleteMany({ where: { storeId } }),
      this.prisma.storeHour.createMany({
        data: hours.map((h) => ({
          storeId,
          dayOfWeek: h.dayOfWeek,
          opensAt: toTime(h.opensAt),
          closesAt: toTime(h.closesAt),
          isClosed: h.isClosed,
        })),
      }),
    ]);

    return this.getStoreHours(storeId);
  }

  async getStoreHours(storeId: string) {
    const hours = await this.prisma.storeHour.findMany({
      where: { storeId },
      orderBy: [{ dayOfWeek: 'asc' }, { opensAt: 'asc' }],
    });

    return hours.map((h) => ({
      id: h.id,
      dayOfWeek: h.dayOfWeek,
      opensAt: fromTime(h.opensAt),
      closesAt: fromTime(h.closesAt),
      isClosed: h.isClosed,
    }));
  }

  async listBlackouts(storeId: string) {
    return this.prisma.blackout.findMany({
      where: { storeId, endsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
      include: { station: { select: { name: true } } },
    });
  }

  async createBlackout(storeId: string, input: BlackoutInput) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    const conflicts = await this.prisma.booking.findMany({
      where: {
        storeId,
        ...(input.stationId === null ? {} : { stationId: input.stationId }),
        status: { in: ['HELD', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { publicId: true, startsAt: true, serviceNameSnapshot: true },
    });

    // Same principle as deactivating a station: never silently strand a paying customer.
    if (conflicts.length > 0) {
      throw AppError.validation(
        `${conflicts.length} existing booking(s) fall inside this window. Cancel or move them first.`,
        { conflicts },
      );
    }

    return this.prisma.blackout.create({
      data: {
        storeId,
        stationId: input.stationId,
        startsAt,
        endsAt,
        reason: input.reason ?? null,
      },
    });
  }

  async deleteBlackout(storeId: string, blackoutId: string) {
    const blackout = await this.prisma.blackout.findFirst({
      where: { id: blackoutId, storeId },
    });
    if (blackout === null) throw AppError.notFound('Blackout');

    await this.prisma.blackout.delete({ where: { id: blackoutId } });
    return { deleted: true };
  }

  async getSettings(storeId: string) {
    const settings = await this.prisma.storeSettings.findUnique({ where: { storeId } });
    if (settings === null) throw AppError.notFound('Store settings');
    return settings;
  }

  async updateSettings(storeId: string, input: StoreSettingsInput) {
    return this.prisma.storeSettings.update({ where: { storeId }, data: input });
  }

  // ── Guards ─────────────────────────────────────────────────────────────────

  private async assertStation(storeId: string, stationId: string): Promise<void> {
    const station = await this.prisma.station.findFirst({ where: { id: stationId, storeId } });
    if (station === null) throw AppError.notFound('Station');
  }

  private async assertRule(storeId: string, ruleId: string): Promise<void> {
    const rule = await this.prisma.allocationRule.findFirst({ where: { id: ruleId, storeId } });
    if (rule === null) throw AppError.notFound('Allocation rule');
  }

  private async assertRuleReferences(
    storeId: string,
    input: AllocationRuleInput,
  ): Promise<void> {
    const [stations, services] = await Promise.all([
      this.prisma.station.count({ where: { id: { in: input.stationIds }, storeId } }),
      this.prisma.service.count({
        where: { id: { in: input.serviceIds }, storeId, deletedAt: null },
      }),
    ]);

    if (stations !== input.stationIds.length) {
      throw AppError.validation('One or more stations do not belong to this store.');
    }
    if (services !== input.serviceIds.length) {
      throw AppError.validation('One or more services do not belong to this store.');
    }
  }
}

function applyTime(dayStart: DateTime, hhmm: string): DateTime {
  const [hour, minute] = hhmm.split(':').map(Number);
  return dayStart.set({ hour, minute, second: 0, millisecond: 0 });
}
