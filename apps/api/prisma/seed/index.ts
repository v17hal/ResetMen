/**
 * Seeds a complete, browsable, bookable RESET store so that `pnpm dev` produces something
 * real on the first run: one outlet, three stations, the photographed MEN menu, store hours,
 * a station designation, an allocation rule, and an owner login.
 *
 * Idempotent — safe to run repeatedly.
 */
import { PrismaClient } from '@prisma/client';

import { ADDON_GROUPS, MEN_CATEGORIES } from './men-menu.js';

const prisma = new PrismaClient();

/** `09:00` in the `time` column type. Prisma wants a Date; only the time part is stored. */
function localTime(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

async function main(): Promise<void> {
  console.log('▸ Seeding RESET…');

  const store = await prisma.store.upsert({
    where: { slug: 'reset-satellite' },
    update: {},
    create: {
      name: 'RESET — Satellite',
      slug: 'reset-satellite',
      timezone: 'Asia/Kolkata',
      city: 'Ahmedabad',
      isActive: true,
      settings: {
        create: {
          bufferMinutes: 5,
          slotGranularityMinutes: 5,
          bookingHorizonDays: 7,
          minLeadMinutes: 0,
          holdTtlMinutes: 10,
          cancellationWindowMinutes: 120,
        },
      },
    },
  });
  console.log(`  store          ${store.name}`);

  // ── Store hours: 09:00–21:00, closed Mondays ────────────────────────────────
  await prisma.storeHour.deleteMany({ where: { storeId: store.id } });
  await prisma.storeHour.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      storeId: store.id,
      dayOfWeek,
      opensAt: localTime('09:00'),
      closesAt: localTime('21:00'),
      isClosed: dayOfWeek === 1,
    })),
  });
  console.log('  hours          09:00–21:00, closed Mondays');

  // ── Catalog ─────────────────────────────────────────────────────────────────
  const segment = await prisma.segment.upsert({
    where: { storeId_slug: { storeId: store.id, slug: 'men' } },
    update: {},
    create: { storeId: store.id, name: 'Men', slug: 'men', sortOrder: 0 },
  });

  const addonGroupIds = new Map<string, string>();
  for (const [index, group] of ADDON_GROUPS.entries()) {
    const existing = await prisma.addonGroup.findFirst({
      where: { storeId: store.id, name: group.name },
    });

    const record =
      existing ??
      (await prisma.addonGroup.create({
        data: {
          storeId: store.id,
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          sortOrder: index,
        },
      }));

    addonGroupIds.set(group.key, record.id);

    for (const [optionIndex, option] of group.options.entries()) {
      const existingOption = await prisma.addonOption.findFirst({
        where: { addonGroupId: record.id, name: option.name },
      });
      if (existingOption) continue;

      await prisma.addonOption.create({
        data: {
          addonGroupId: record.id,
          name: option.name,
          pricePaise: option.pricePaise,
          durationDeltaMinutes: option.durationDeltaMinutes ?? 0,
          sortOrder: optionIndex,
        },
      });
    }
  }
  console.log(`  add-on groups  ${ADDON_GROUPS.map((g) => g.name).join(', ')}`);

  const serviceIds = new Map<string, string>();
  for (const [categoryIndex, category] of MEN_CATEGORIES.entries()) {
    const categoryRecord = await prisma.category.upsert({
      where: { storeId_slug: { storeId: store.id, slug: category.slug } },
      update: {},
      create: {
        storeId: store.id,
        segmentId: segment.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        sortOrder: categoryIndex,
      },
    });

    for (const [serviceIndex, service] of category.services.entries()) {
      const serviceRecord = await prisma.service.upsert({
        where: { storeId_slug: { storeId: store.id, slug: service.slug } },
        update: {},
        create: {
          storeId: store.id,
          categoryId: categoryRecord.id,
          name: service.name,
          slug: service.slug,
          description: service.description,
          pricePaise: service.pricePaise,
          durationMinutes: service.durationMinutes,
          isActive: service.isActive,
          sortOrder: serviceIndex,
        },
      });

      serviceIds.set(service.slug, serviceRecord.id);

      for (const key of service.addonGroupKeys) {
        const addonGroupId = addonGroupIds.get(key);
        if (addonGroupId === undefined) continue;

        await prisma.serviceAddonGroup.upsert({
          where: {
            serviceId_addonGroupId: { serviceId: serviceRecord.id, addonGroupId },
          },
          update: {},
          create: { serviceId: serviceRecord.id, addonGroupId },
        });
      }
    }

    console.log(
      `  category       ${category.name} (${category.services.length} services)`,
    );
  }

  // ── Stations ────────────────────────────────────────────────────────────────
  const stations = [];
  for (const [index, name] of ['Station 1', 'Station 2', 'Station 3'].entries()) {
    const existing = await prisma.station.findFirst({ where: { storeId: store.id, name } });
    stations.push(
      existing ??
        (await prisma.station.create({
          data: { storeId: store.id, name, sortOrder: index + 1 },
        })),
    );
  }
  console.log('  stations       Station 1, Station 2, Station 3');

  // Station 3 is the corner chair — head-only, per the client's space-constraint note.
  const cornerChair = stations[2]!;
  const headOnly = [
    serviceIds.get('head'),
    serviceIds.get('head-neck-shoulder'),
  ].filter((id): id is string => id !== undefined);

  await prisma.station.update({
    where: { id: cornerChair.id },
    data: { allowsAllServices: false },
  });
  for (const serviceId of headOnly) {
    await prisma.stationService.upsert({
      where: { stationId_serviceId: { stationId: cornerChair.id, serviceId } },
      update: {},
      create: { stationId: cornerChair.id, serviceId },
    });
  }
  console.log('  designation    Station 3 → Head, Head + Neck + Shoulder only');

  // ── The morning ₹199 push (client requirement, 02/08/2026) ──────────────────
  const basicId = serviceIds.get('full-body-basic');
  const existingRule = await prisma.allocationRule.findFirst({
    where: { storeId: store.id, name: 'Morning ₹199 push' },
  });

  if (existingRule === null && basicId !== undefined) {
    await prisma.allocationRule.create({
      data: {
        storeId: store.id,
        name: 'Morning ₹199 push',
        mode: 'EXCLUSIVE_TO',
        recurrence: 'WEEKLY',
        daysOfWeek: [2, 3, 4, 5, 6],
        startsAtLocal: localTime('09:00'),
        endsAtLocal: localTime('12:00'),
        priority: 100,
        isActive: false, // seeded as an example; the owner switches it on
        stations: { create: [{ stationId: stations[1]!.id }] },
        services: { create: [{ serviceId: basicId }] },
      },
    });
    console.log('  allocation     "Morning ₹199 push" (seeded inactive)');
  }

  // ── Streak & scratch card defaults (docs/10 Q10 — starting values, all tunable) ──
  const existingStreak = await prisma.streakRule.findFirst({ where: { storeId: store.id } });
  if (existingStreak === null) {
    await prisma.streakRule.create({
      data: {
        storeId: store.id,
        name: '5 visits in 30 days',
        requiredVisits: 5,
        withinDays: 30,
        rewardType: 'FLAT_OFF',
        rewardValue: 10000, // ₹100 off
        validityDays: 30,
      },
    });
    console.log('  streak rule    5 visits in 30 days → ₹100 off');
  }

  const existingCampaign = await prisma.scratchCampaign.findFirst({
    where: { storeId: store.id },
  });
  if (existingCampaign === null) {
    await prisma.scratchCampaign.create({
      data: {
        storeId: store.id,
        name: 'Post-visit scratch card',
        trigger: 'ON_CHECKIN',
        rewards: {
          create: [
            { label: '₹20 off your next reset', rewardType: 'FLAT_OFF', rewardValue: 2000, weight: 60 },
            { label: '₹50 off your next reset', rewardType: 'FLAT_OFF', rewardValue: 5000, weight: 25 },
            { label: 'A free add-on', rewardType: 'FREE_ADDON', rewardValue: 0, weight: 10 },
            { label: 'A free Head session', rewardType: 'FREE_SERVICE', rewardValue: 0, weight: 5 },
          ],
        },
      },
    });
    console.log('  scratch pool   60/25/10/5 weighting');
  }

  console.log('\n✓ Seed complete.\n');
  console.log('  Note: admin users are NOT seeded — passwords are created through the');
  console.log('  admin panel so no default credentials ever exist in a deployed store.\n');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
