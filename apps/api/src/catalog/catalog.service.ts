import { Injectable } from '@nestjs/common';

import { AppError } from '../common/errors.js';
import { loadEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class CatalogService {
  /**
   * Whether checkout collects money.
   *
   * Served from the store endpoint so the web app and the Flutter app render the right
   * thing without being rebuilt when the store's mind changes — one config flag on the
   * server rather than three release cycles.
   */
  private readonly paymentsEnabled = loadEnv().PAYMENTS_ENABLED;

  constructor(private readonly prisma: PrismaService) {}

  async getStore(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: { settings: true, storeHours: { orderBy: [{ dayOfWeek: 'asc' }] } },
    });
    if (store === null) throw AppError.notFound('Store');

    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      timezone: store.timezone,
      address: store.address,
      city: store.city,
      phone: store.phone,
      lat: store.lat,
      lng: store.lng,
      bookingHorizonDays: store.settings?.bookingHorizonDays ?? 7,
      cancellationWindowMinutes: store.settings?.cancellationWindowMinutes ?? 120,
      paymentsEnabled: this.paymentsEnabled,
      hours: store.storeHours.map((h) => ({
        dayOfWeek: h.dayOfWeek,
        opensAt: formatTime(h.opensAt),
        closesAt: formatTime(h.closesAt),
        isClosed: h.isClosed,
      })),
    };
  }

  async getSegments(storeId: string) {
    return this.prisma.segment.findMany({
      where: { storeId, isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, slug: true, imageUrl: true },
    });
  }

  async getCategories(storeId: string, segmentId?: string) {
    return this.prisma.category.findMany({
      where: {
        storeId,
        isActive: true,
        deletedAt: null,
        ...(segmentId === undefined ? {} : { segmentId }),
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        imageUrl: true,
        segmentId: true,
      },
    });
  }

  async getServices(storeId: string, categoryId?: string) {
    return this.prisma.service.findMany({
      where: {
        storeId,
        isActive: true,
        deletedAt: null,
        ...(categoryId === undefined ? {} : { categoryId }),
      },
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        imageUrl: true,
        pricePaise: true,
        durationMinutes: true,
        categoryId: true,
      },
    });
  }

  /** Service detail including its add-on groups — one call, so the detail screen never waterfalls. */
  async getService(storeId: string, idOrSlug: string) {
    const service = await this.prisma.service.findFirst({
      where: {
        storeId,
        isActive: true,
        deletedAt: null,
        OR: [{ slug: idOrSlug }, ...(isUuid(idOrSlug) ? [{ id: idOrSlug }] : [])],
      },
      include: {
        addonGroups: {
          orderBy: { sortOrder: 'asc' },
          include: {
            addonGroup: {
              include: {
                options: {
                  where: { isActive: true },
                  orderBy: { sortOrder: 'asc' },
                },
              },
            },
          },
        },
      },
    });
    if (service === null) throw AppError.notFound('Service');

    return {
      id: service.id,
      name: service.name,
      slug: service.slug,
      description: service.description,
      imageUrl: service.imageUrl,
      pricePaise: service.pricePaise,
      durationMinutes: service.durationMinutes,
      categoryId: service.categoryId,
      addonGroups: service.addonGroups
        .filter((link) => link.addonGroup.isActive)
        .map((link) => ({
          id: link.addonGroup.id,
          name: link.addonGroup.name,
          minSelect: link.addonGroup.minSelect,
          maxSelect: link.addonGroup.maxSelect,
          options: link.addonGroup.options.map((option) => ({
            id: option.id,
            name: option.name,
            priceDeltaPaise: option.pricePaise,
            durationDeltaMinutes: option.durationDeltaMinutes,
          })),
        })),
    };
  }

  /**
   * Everything the home screen needs in one request — saves four round-trips on a cold app
   * open, which is the difference between the app feeling instant and feeling like a website.
   */
  async getHome(storeId: string, segmentId?: string) {
    const segments = await this.getSegments(storeId);
    const activeSegmentId = segmentId ?? segments[0]?.id;

    const categories =
      activeSegmentId === undefined ? [] : await this.getCategories(storeId, activeSegmentId);

    const services = await this.getServices(storeId);
    const categoryIds = new Set(categories.map((c) => c.id));

    return {
      segments,
      activeSegmentId: activeSegmentId ?? null,
      categories: categories.map((category) => {
        const inCategory = services.filter((s) => s.categoryId === category.id);
        return {
          ...category,
          serviceCount: inCategory.length,
          fromPricePaise: inCategory.reduce<number | null>(
            (min, s) => (min === null || s.pricePaise < min ? s.pricePaise : min),
            null,
          ),
        };
      }),
      services: services.filter((s) => categoryIds.has(s.categoryId)),
    };
  }
}

function formatTime(time: Date): string {
  const h = String(time.getUTCHours()).padStart(2, '0');
  const m = String(time.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
