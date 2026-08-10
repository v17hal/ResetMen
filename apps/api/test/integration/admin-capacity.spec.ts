import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { AllocationRuleInput } from '@reset/types';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CapacityService } from '../../src/admin/capacity.service.js';
import { AvailabilityService } from '../../src/availability/availability.service.js';
import { ScheduleResolverService } from '../../src/availability/schedule-resolver.service.js';
import { PrismaService } from '../../src/database/prisma.service.js';

/**
 * The client's 02/08/2026 capacity requirements, end to end against a real database.
 *
 * The engine's behaviour is already proven in `packages/slot-engine-core`; what these
 * exercise is the wiring — that a rule stored in Postgres, resolved through timezones and
 * recurrence, actually changes what a customer sees.
 */
describe('admin capacity', () => {
  let moduleRef: TestingModule;
  let capacity: CapacityService;
  let availability: AvailabilityService;

  const raw = new PrismaClient();
  let storeId: string;
  let timezone: string;
  let stations: { id: string; name: string }[];
  let headId: string;
  let basicId: string;
  let premiumId: string;
  let date: string;
  let weekday: number;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, ScheduleResolverService, AvailabilityService, CapacityService],
    }).compile();

    await moduleRef.get(PrismaService).$connect();
    capacity = moduleRef.get(CapacityService);
    availability = moduleRef.get(AvailabilityService);

    const store = await raw.store.findFirstOrThrow({ where: { slug: 'reset-satellite' } });
    storeId = store.id;
    timezone = store.timezone;

    stations = await raw.station.findMany({
      where: { storeId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    });

    const byslug = async (slug: string) =>
      (await raw.service.findFirstOrThrow({ where: { storeId, slug } })).id;

    headId = await byslug('head');
    basicId = await byslug('full-body-basic');
    premiumId = await byslug('full-body-premium');

    // The seeded store is closed on Mondays.
    let cursor = DateTime.now().setZone(timezone).plus({ days: 1 }).startOf('day');
    while (cursor.weekday === 1) cursor = cursor.plus({ days: 1 });
    date = cursor.toISODate()!;
    weekday = cursor.weekday === 7 ? 0 : cursor.weekday;
  });

  afterAll(async () => {
    await raw.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await raw.allocationRuleStation.deleteMany({});
    await raw.allocationRuleService.deleteMany({});
    await raw.allocationRule.deleteMany({});
    await raw.bookingStatusHistory.deleteMany({});
    await raw.bookingAddon.deleteMany({});
    await raw.booking.deleteMany({});
    await raw.blackout.deleteMany({});

    // Restore the seeded designation: Station 3 is head-only.
    await raw.station.updateMany({ where: { storeId }, data: { isActive: true } });
  });

  const stationsAt = async (serviceId: string, hhmm: string): Promise<number> => {
    const result = await availability.getSlots({
      storeId,
      serviceId,
      date,
      addonOptionIds: [],
    });
    return (
      result.slots.find((s) => s.startsAt.slice(11, 16) === hhmm)?.stationsAvailable ?? 0
    );
  };

  describe('the morning ₹199 push', () => {
    const rule = (): AllocationRuleInput => ({
      name: 'Morning ₹199 push',
      mode: 'EXCLUSIVE_TO',
      recurrence: 'WEEKLY',
      daysOfWeek: [weekday],
      dateFrom: null,
      dateTo: null,
      startsAtLocal: '09:00',
      endsAtLocal: '12:00',
      stationIds: [stations[0]!.id, stations[1]!.id],
      serviceIds: [basicId],
      priority: 100,
      isActive: true,
    });

    it('reserves capacity for the pushed service and takes it from the others', async () => {
      // Station 3 is head-only, so before the rule Basic sees 2 stations and Head sees 3.
      expect(await stationsAt(basicId, '10:00')).toBe(2);
      expect(await stationsAt(headId, '10:00')).toBe(3);

      await capacity.createAllocationRule(storeId, rule());

      // Basic keeps both of its stations; Head loses the two that were reserved and is left
      // with only the corner chair.
      expect(await stationsAt(basicId, '10:00')).toBe(2);
      expect(await stationsAt(headId, '10:00')).toBe(1);
      expect(await stationsAt(premiumId, '10:00')).toBe(0);
    });

    it('gives every service its capacity back once the window closes', async () => {
      await capacity.createAllocationRule(storeId, rule());

      expect(await stationsAt(headId, '12:00')).toBe(3);
      expect(await stationsAt(premiumId, '12:00')).toBe(2);
    });

    it('applies to a session that merely overlaps the window', async () => {
      await capacity.createAllocationRule(storeId, rule());

      // A 10-minute Head at 11:55 runs to 12:05 — still overlapping, so the reserved
      // stations stay off-limits.
      expect(await stationsAt(headId, '11:55')).toBe(1);
    });

    it('does nothing on days the rule does not run', async () => {
      await capacity.createAllocationRule(storeId, {
        ...rule(),
        daysOfWeek: [weekday === 0 ? 6 : weekday - 1],
      });

      expect(await stationsAt(headId, '10:00')).toBe(3);
    });

    it('does nothing while inactive', async () => {
      await capacity.createAllocationRule(storeId, { ...rule(), isActive: false });
      expect(await stationsAt(headId, '10:00')).toBe(3);
    });
  });

  describe('preview', () => {
    it('reports the before/after effect on every service', async () => {
      const preview = await capacity.previewAllocationRule(
        storeId,
        {
          name: 'Preview',
          mode: 'EXCLUSIVE_TO',
          recurrence: 'WEEKLY',
          daysOfWeek: [weekday],
          dateFrom: null,
          dateTo: null,
          startsAtLocal: '09:00',
          endsAtLocal: '12:00',
          stationIds: [stations[0]!.id, stations[1]!.id],
          serviceIds: [basicId],
          priority: 100,
          isActive: true,
        },
        date,
      );

      const head = preview.effects.find((e) => e.serviceId === headId)!;
      const basic = preview.effects.find((e) => e.serviceId === basicId)!;
      const premium = preview.effects.find((e) => e.serviceId === premiumId)!;

      expect(head.stationsBeforeInWindow).toBe(3);
      expect(head.stationsAfterInWindow).toBe(1);
      expect(basic.stationsAfterInWindow).toBe(2);

      // The warning that matters: Premium becomes completely unbookable all morning.
      expect(premium.stationsAfterInWindow).toBe(0);
      expect(premium.slotsAfter).toBeLessThan(premium.slotsBefore);
    });

    it('lists bookings the rule would strand', async () => {
      const startsAt = DateTime.fromISO(`${date}T10:00:00`, { zone: timezone }).toJSDate();

      await raw.booking.create({
        data: {
          publicId: 'RST-PREVW1',
          storeId,
          serviceId: headId,
          stationId: stations[0]!.id,
          status: 'CONFIRMED',
          source: 'APP',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 10 * 60_000),
          blockedUntil: new Date(startsAt.getTime() + 15 * 60_000),
          totalDurationMinutes: 10,
          serviceNameSnapshot: 'Head',
          basePricePaise: 4900,
          addonsPricePaise: 0,
          discountPaise: 0,
          payablePaise: 4900,
        },
      });

      const preview = await capacity.previewAllocationRule(
        storeId,
        {
          name: 'Preview',
          mode: 'EXCLUSIVE_TO',
          recurrence: 'WEEKLY',
          daysOfWeek: [weekday],
          dateFrom: null,
          dateTo: null,
          startsAtLocal: '09:00',
          endsAtLocal: '12:00',
          stationIds: [stations[0]!.id],
          serviceIds: [basicId],
          priority: 100,
          isActive: true,
        },
        date,
      );

      expect(preview.conflicts).toHaveLength(1);
      expect(preview.conflicts[0]!.publicId).toBe('RST-PREVW1');
    });
  });

  describe('station designation', () => {
    it('reports a service that no station can host', async () => {
      await capacity.setStationServices(storeId, stations[0]!.id, {
        allowsAllServices: false,
        serviceIds: [headId],
      });
      await capacity.setStationServices(storeId, stations[1]!.id, {
        allowsAllServices: false,
        serviceIds: [headId],
      });

      const coverage = await capacity.coverageWarnings(storeId);
      const premium = coverage.find((c) => c.serviceId === premiumId)!;

      expect(premium.eligibleStations).toBe(0);
      expect(premium.warning).toMatch(/never be booked/i);

      // Restore for the other tests.
      await capacity.setStationServices(storeId, stations[0]!.id, {
        allowsAllServices: true,
        serviceIds: [],
      });
      await capacity.setStationServices(storeId, stations[1]!.id, {
        allowsAllServices: true,
        serviceIds: [],
      });
    });
  });

  describe('guard rails', () => {
    it('refuses to deactivate a station that has upcoming bookings', async () => {
      const startsAt = DateTime.fromISO(`${date}T14:00:00`, { zone: timezone }).toJSDate();

      await raw.booking.create({
        data: {
          publicId: 'RST-GUARD1',
          storeId,
          serviceId: headId,
          stationId: stations[0]!.id,
          status: 'CONFIRMED',
          source: 'APP',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 10 * 60_000),
          blockedUntil: new Date(startsAt.getTime() + 15 * 60_000),
          totalDurationMinutes: 10,
          serviceNameSnapshot: 'Head',
          basePricePaise: 4900,
          addonsPricePaise: 0,
          discountPaise: 0,
          payablePaise: 4900,
        },
      });

      await expect(
        capacity.updateStation(storeId, stations[0]!.id, { isActive: false }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses a blackout that would strand an existing booking', async () => {
      const startsAt = DateTime.fromISO(`${date}T15:00:00`, { zone: timezone });

      await raw.booking.create({
        data: {
          publicId: 'RST-GUARD2',
          storeId,
          serviceId: headId,
          stationId: stations[0]!.id,
          status: 'CONFIRMED',
          source: 'APP',
          startsAt: startsAt.toJSDate(),
          endsAt: startsAt.plus({ minutes: 10 }).toJSDate(),
          blockedUntil: startsAt.plus({ minutes: 15 }).toJSDate(),
          totalDurationMinutes: 10,
          serviceNameSnapshot: 'Head',
          basePricePaise: 4900,
          addonsPricePaise: 0,
          discountPaise: 0,
          payablePaise: 4900,
        },
      });

      await expect(
        capacity.createBlackout(storeId, {
          stationId: stations[0]!.id,
          startsAt: startsAt.minus({ hours: 1 }).toISO()!,
          endsAt: startsAt.plus({ hours: 1 }).toISO()!,
          reason: 'Maintenance',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('rejects a rule referencing a station from another store', async () => {
      await expect(
        capacity.createAllocationRule(storeId, {
          name: 'Bad',
          mode: 'EXCLUSIVE_TO',
          recurrence: 'WEEKLY',
          daysOfWeek: [weekday],
          dateFrom: null,
          dateTo: null,
          startsAtLocal: '09:00',
          endsAtLocal: '12:00',
          stationIds: ['00000000-0000-0000-0000-000000000000'],
          serviceIds: [basicId],
          priority: 100,
          isActive: true,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
});
