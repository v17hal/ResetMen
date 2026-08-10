import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AvailabilityService } from '../../src/availability/availability.service.js';
import { ScheduleResolverService } from '../../src/availability/schedule-resolver.service.js';
import { BookingService } from '../../src/booking/booking.service.js';
import { AppError } from '../../src/common/errors.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RewardsService } from '../../src/rewards/rewards.service.js';
import { ScratchService } from '../../src/rewards/scratch.service.js';

/**
 * The test that proves the product's core promise.
 *
 * Everything else in this codebase can be patched after launch. This one cannot: if two
 * customers can ever be assigned the same station at overlapping times, the store has two
 * people standing in front of one bed and no software fix helps at that moment.
 *
 * Runs against a real PostgreSQL — the guarantee lives in a GiST exclusion constraint, so a
 * mocked database would prove nothing at all.
 */
describe('booking concurrency', () => {
  let moduleRef: TestingModule;
  let bookings: BookingService;
  let prisma: PrismaService;

  const raw = new PrismaClient();
  let storeId: string;
  let headServiceId: string;
  let localDate: string;
  let timezone: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ScheduleResolverService,
        AvailabilityService,
        BookingService,
        // Booking applies wallet rewards at hold time, so it needs the real service here —
        // a stub would let a regression in reward reservation pass this suite unnoticed.
        RewardsService,
        ScratchService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    bookings = moduleRef.get(BookingService);

    const store = await raw.store.findFirstOrThrow({ where: { slug: 'reset-satellite' } });
    storeId = store.id;
    timezone = store.timezone;

    headServiceId = (
      await raw.service.findFirstOrThrow({ where: { storeId, slug: 'head' } })
    ).id;

    // A Tuesday — the seeded store is closed on Mondays.
    localDate = nextOpenDate(timezone);
  });

  afterAll(async () => {
    await raw.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await raw.bookingStatusHistory.deleteMany({});
    await raw.bookingAddon.deleteMany({});
    await raw.booking.deleteMany({});
  });

  it('lets exactly one of 50 simultaneous holds win the last slot', async () => {
    // Squeeze capacity down to a single station so there is exactly one slot to fight over.
    const stations = await raw.station.findMany({ where: { storeId }, orderBy: { sortOrder: 'asc' } });
    const [keep, ...rest] = stations;
    await raw.station.updateMany({
      where: { id: { in: rest.map((s) => s.id) } },
      data: { isActive: false },
    });

    try {
      const slots = await moduleRef.get(AvailabilityService).getSlots({
        storeId,
        serviceId: headServiceId,
        date: localDate,
        addonOptionIds: [],
      });
      expect(slots.slots.length).toBeGreaterThan(0);

      const target = slots.slots[0]!.startsAt;

      const attempts = await Promise.allSettled(
        Array.from({ length: 50 }, () =>
          bookings.hold({
            storeId,
            serviceId: headServiceId,
            addonOptionIds: [],
            startsAt: target,
            userId: null,
            source: 'APP',
          }),
        ),
      );

      const succeeded = attempts.filter((a) => a.status === 'fulfilled');
      const failed = attempts.filter((a) => a.status === 'rejected');

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(49);

      // Every loser gets a clean, actionable 409 — not a 500, and not a hang.
      for (const rejection of failed) {
        const reason = (rejection as PromiseRejectedResult).reason as AppError;
        expect(reason).toBeInstanceOf(AppError);
        expect(['SLOT_TAKEN', 'SLOT_UNAVAILABLE']).toContain(reason.code);
        expect(reason.getStatus()).toBe(409);
      }

      const persisted = await raw.booking.findMany({ where: { storeId } });
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.stationId).toBe(keep!.id);
    } finally {
      await raw.station.updateMany({
        where: { id: { in: rest.map((s) => s.id) } },
        data: { isActive: true },
      });
    }
  }, 60_000);

  it('never produces two overlapping bookings on one station', async () => {
    const slots = await moduleRef.get(AvailabilityService).getSlots({
      storeId,
      serviceId: headServiceId,
      date: localDate,
      addonOptionIds: [],
    });

    // Hammer the same handful of early slots from many directions at once.
    const targets = slots.slots.slice(0, 5).map((s) => s.startsAt);
    await Promise.allSettled(
      targets.flatMap((startsAt) =>
        Array.from({ length: 10 }, () =>
          bookings.hold({
            storeId,
            serviceId: headServiceId,
            addonOptionIds: [],
            startsAt,
            userId: null,
            source: 'WEB',
          }),
        ),
      ),
    );

    const persisted = await raw.booking.findMany({
      where: { storeId, status: { in: ['HELD', 'CONFIRMED'] } },
      orderBy: [{ stationId: 'asc' }, { startsAt: 'asc' }],
    });

    for (let i = 1; i < persisted.length; i += 1) {
      const previous = persisted[i - 1]!;
      const current = persisted[i]!;
      if (previous.stationId !== current.stationId) continue;

      expect(
        current.startsAt.getTime(),
        `overlap on station ${current.stationId}`,
      ).toBeGreaterThanOrEqual(previous.blockedUntil.getTime());
    }
  }, 60_000);

  it('is idempotent — the same key returns the same booking', async () => {
    const slots = await moduleRef.get(AvailabilityService).getSlots({
      storeId,
      serviceId: headServiceId,
      date: localDate,
      addonOptionIds: [],
    });
    const target = slots.slots[0]!.startsAt;

    const request = {
      storeId,
      serviceId: headServiceId,
      addonOptionIds: [] as string[],
      startsAt: target,
      userId: null,
      source: 'APP' as const,
      idempotencyKey: 'test-key-0001',
    };

    const first = await bookings.hold(request);
    const second = await bookings.hold(request);

    expect(second.bookingId).toBe(first.bookingId);
    expect(await raw.booking.count({ where: { storeId } })).toBe(1);
  }, 30_000);

  it('refuses a time the engine never offered', async () => {
    // 03:00 local — the store opens at 09:00.
    const middleOfTheNight = DateTime.fromISO(`${localDate}T03:00:00`, { zone: timezone });

    await expect(
      bookings.hold({
        storeId,
        serviceId: headServiceId,
        addonOptionIds: [],
        startsAt: middleOfTheNight.toISO()!,
        userId: null,
        source: 'APP',
      }),
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  }, 30_000);

  it('frees the slot again once a hold expires', async () => {
    const slots = await moduleRef.get(AvailabilityService).getSlots({
      storeId,
      serviceId: headServiceId,
      date: localDate,
      addonOptionIds: [],
    });
    const target = slots.slots[0]!.startsAt;

    const held = await bookings.hold({
      storeId,
      serviceId: headServiceId,
      addonOptionIds: [],
      startsAt: target,
      userId: null,
      source: 'APP',
    });

    // Backdate the hold rather than waiting ten minutes.
    await raw.booking.update({
      where: { id: held.bookingId },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });

    const second = await bookings.hold({
      storeId,
      serviceId: headServiceId,
      addonOptionIds: [],
      startsAt: target,
      userId: null,
      source: 'WEB',
    });

    expect(second.bookingId).not.toBe(held.bookingId);

    const expired = await raw.booking.findUniqueOrThrow({ where: { id: held.bookingId } });
    expect(expired.status).toBe('EXPIRED');
  }, 30_000);
});

/** The seeded store is closed on Mondays; find the next day it is open. */
function nextOpenDate(zone: string): string {
  let cursor = DateTime.now().setZone(zone).plus({ days: 1 }).startOf('day');
  while (cursor.weekday === 1) cursor = cursor.plus({ days: 1 });
  return cursor.toISODate()!;
}
