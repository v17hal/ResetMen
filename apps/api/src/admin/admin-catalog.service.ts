import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AddonGroupInput,
  AddonOptionInput,
  CategoryInput,
  SegmentInput,
  ServiceInput,
} from '@reset/types';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Catalog administration.
 *
 * Two rules run through all of it:
 *
 *  1. **Soft delete only.** Bookings snapshot the service name and price, but they still
 *     carry `serviceId`, and reports group by it. A hard delete would orphan history.
 *  2. **A service is unpublishable without a positive duration.** The availability engine
 *     cannot schedule what has no length — which is exactly what keeps the unpriced Instant
 *     Glow placeholders (docs/10-open-questions.md#q2) invisible to customers instead of
 *     bookable at zero minutes.
 */
@Injectable()
export class AdminCatalogService {
  private readonly logger = new Logger(AdminCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Segments ───────────────────────────────────────────────────────────────

  async listSegments(storeId: string) {
    return this.prisma.segment.findMany({
      where: { storeId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { categories: true } } },
    });
  }

  async createSegment(storeId: string, input: SegmentInput) {
    return this.guardSlug('segment', () =>
      this.prisma.segment.create({ data: { storeId, ...input } }),
    );
  }

  async updateSegment(storeId: string, id: string, input: SegmentInput) {
    const before = await this.prisma.segment.findFirst({ where: { id, storeId, deletedAt: null } });
    if (before === null) throw AppError.notFound('Segment');

    const after = await this.guardSlug('segment', () =>
      this.prisma.segment.update({ where: { id }, data: input }),
    );
    return { before, after };
  }

  async deleteSegment(storeId: string, id: string) {
    const segment = await this.prisma.segment.findFirst({
      where: { id, storeId, deletedAt: null },
      include: { _count: { select: { categories: true } } },
    });
    if (segment === null) throw AppError.notFound('Segment');

    if (segment._count.categories > 0) {
      throw AppError.validation(
        `"${segment.name}" still has ${segment._count.categories} categories. Move or remove them first.`,
      );
    }

    await this.prisma.segment.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return segment;
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  async listCategories(storeId: string) {
    return this.prisma.category.findMany({
      where: { storeId, deletedAt: null },
      orderBy: [{ segmentId: 'asc' }, { sortOrder: 'asc' }],
      include: {
        segment: { select: { name: true } },
        _count: { select: { services: true } },
      },
    });
  }

  async createCategory(storeId: string, input: CategoryInput) {
    await this.assertBelongs('segment', storeId, input.segmentId);

    return this.guardSlug('category', () =>
      this.prisma.category.create({ data: { storeId, ...input } }),
    );
  }

  async updateCategory(storeId: string, id: string, input: CategoryInput) {
    const before = await this.prisma.category.findFirst({ where: { id, storeId, deletedAt: null } });
    if (before === null) throw AppError.notFound('Category');

    await this.assertBelongs('segment', storeId, input.segmentId);

    const after = await this.guardSlug('category', () =>
      this.prisma.category.update({ where: { id }, data: input }),
    );
    return { before, after };
  }

  async deleteCategory(storeId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, storeId, deletedAt: null },
      include: { _count: { select: { services: true } } },
    });
    if (category === null) throw AppError.notFound('Category');

    if (category._count.services > 0) {
      throw AppError.validation(
        `"${category.name}" still has ${category._count.services} services. Move or remove them first.`,
      );
    }

    await this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return category;
  }

  // ── Services ───────────────────────────────────────────────────────────────

  async listServices(storeId: string) {
    return this.prisma.service.findMany({
      where: { storeId, deletedAt: null },
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
      include: {
        category: { select: { name: true, segment: { select: { name: true } } } },
        addonGroups: { include: { addonGroup: { select: { id: true, name: true } } } },
        _count: { select: { stationServices: true } },
      },
    });
  }

  async createService(storeId: string, input: ServiceInput) {
    await this.assertBelongs('category', storeId, input.categoryId);

    return this.guardSlug('service', () =>
      this.prisma.service.create({ data: { storeId, ...input } }),
    );
  }

  async updateService(storeId: string, id: string, input: ServiceInput) {
    const before = await this.prisma.service.findFirst({ where: { id, storeId, deletedAt: null } });
    if (before === null) throw AppError.notFound('Service');

    await this.assertBelongs('category', storeId, input.categoryId);

    const after = await this.guardSlug('service', () =>
      this.prisma.service.update({ where: { id }, data: input }),
    );

    if (before.durationMinutes !== after.durationMinutes) {
      // Existing bookings keep the duration they were made with; only future ones change.
      this.logger.warn(
        `Service ${after.name} duration changed ${before.durationMinutes}→${after.durationMinutes} min. ` +
          'Existing bookings keep their original length.',
      );
    }

    return { before, after };
  }

  /**
   * Soft-deletes a service, refusing while it still has future bookings.
   *
   * The alternative — deleting anyway — leaves customers holding confirmed bookings for
   * something the store no longer believes in. Deactivating hides it from the catalog
   * without breaking anyone's Saturday.
   */
  async deleteService(storeId: string, id: string) {
    const service = await this.prisma.service.findFirst({ where: { id, storeId, deletedAt: null } });
    if (service === null) throw AppError.notFound('Service');

    const upcoming = await this.prisma.booking.count({
      where: {
        serviceId: id,
        status: { in: ['HELD', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] },
        startsAt: { gte: new Date() },
      },
    });

    if (upcoming > 0) {
      throw AppError.validation(
        `"${service.name}" has ${upcoming} upcoming booking(s). Deactivate it instead — ` +
          'it will disappear from the catalog and existing bookings will still be honoured.',
        { upcoming },
      );
    }

    await this.prisma.service.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return service;
  }

  /** Publish toggle, separate from delete because it is the one staff use daily. */
  async setServiceActive(storeId: string, id: string, isActive: boolean) {
    const service = await this.prisma.service.findFirst({ where: { id, storeId, deletedAt: null } });
    if (service === null) throw AppError.notFound('Service');

    if (isActive && service.durationMinutes <= 0) {
      throw AppError.validation(
        `"${service.name}" has no duration set, so the engine cannot schedule it. ` +
          'Set a duration before publishing.',
      );
    }

    return this.prisma.service.update({ where: { id }, data: { isActive } });
  }

  // ── Add-ons ────────────────────────────────────────────────────────────────

  async listAddonGroups(storeId: string) {
    return this.prisma.addonGroup.findMany({
      where: { storeId },
      orderBy: { sortOrder: 'asc' },
      include: {
        options: { orderBy: { sortOrder: 'asc' } },
        services: { include: { service: { select: { id: true, name: true } } } },
      },
    });
  }

  async createAddonGroup(storeId: string, input: AddonGroupInput) {
    return this.prisma.addonGroup.create({ data: { storeId, ...input } });
  }

  async updateAddonGroup(storeId: string, id: string, input: AddonGroupInput) {
    const before = await this.prisma.addonGroup.findFirst({ where: { id, storeId } });
    if (before === null) throw AppError.notFound('Add-on group');

    const after = await this.prisma.addonGroup.update({ where: { id }, data: input });
    return { before, after };
  }

  async createAddonOption(storeId: string, groupId: string, input: AddonOptionInput) {
    await this.assertBelongs('addonGroup', storeId, groupId);

    const { priceDeltaPaise, ...rest } = input;
    return this.prisma.addonOption.create({
      data: { addonGroupId: groupId, pricePaise: priceDeltaPaise, ...rest },
    });
  }

  async updateAddonOption(storeId: string, id: string, input: AddonOptionInput) {
    const before = await this.prisma.addonOption.findFirst({
      where: { id, addonGroup: { storeId } },
    });
    if (before === null) throw AppError.notFound('Add-on');

    const { priceDeltaPaise, ...rest } = input;
    const after = await this.prisma.addonOption.update({
      where: { id },
      data: { pricePaise: priceDeltaPaise, ...rest },
    });
    return { before, after };
  }

  async deleteAddonOption(storeId: string, id: string) {
    const option = await this.prisma.addonOption.findFirst({
      where: { id, addonGroup: { storeId } },
    });
    if (option === null) throw AppError.notFound('Add-on');

    await this.prisma.addonOption.update({ where: { id }, data: { isActive: false } });
    return option;
  }

  /** Attaches an add-on group to a service, or detaches it. */
  async setServiceAddonGroups(storeId: string, serviceId: string, groupIds: readonly string[]) {
    await this.assertBelongs('service', storeId, serviceId);

    for (const groupId of groupIds) {
      await this.assertBelongs('addonGroup', storeId, groupId);
    }

    await this.prisma.$transaction([
      this.prisma.serviceAddonGroup.deleteMany({ where: { serviceId } }),
      this.prisma.serviceAddonGroup.createMany({
        data: groupIds.map((addonGroupId, index) => ({
          serviceId,
          addonGroupId,
          sortOrder: index,
        })),
      }),
    ]);

    return { serviceId, addonGroupIds: [...groupIds] };
  }

  // ── Ordering ───────────────────────────────────────────────────────────────

  /**
   * Bulk sort-order update, applied in one transaction.
   *
   * Drag-and-drop reordering sends every affected row at once; applying them one request at
   * a time would leave the catalog visibly scrambled if the connection dropped halfway.
   */
  async reorder(
    entity: 'segment' | 'category' | 'service' | 'addonGroup',
    storeId: string,
    items: readonly { id: string; sortOrder: number }[],
  ) {
    for (const item of items) {
      await this.assertBelongs(entity, storeId, item.id);
    }

    const updates = items.map((item) => {
      switch (entity) {
        case 'segment':
          return this.prisma.segment.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } });
        case 'category':
          return this.prisma.category.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } });
        case 'service':
          return this.prisma.service.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } });
        case 'addonGroup':
          return this.prisma.addonGroup.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } });
      }
    });

    await this.prisma.$transaction(updates);
    return { updated: items.length };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertBelongs(
    entity: 'segment' | 'category' | 'service' | 'addonGroup',
    storeId: string,
    id: string,
  ): Promise<void> {
    const found = await (async () => {
      switch (entity) {
        case 'segment':
          return this.prisma.segment.findFirst({ where: { id, storeId, deletedAt: null }, select: { id: true } });
        case 'category':
          return this.prisma.category.findFirst({ where: { id, storeId, deletedAt: null }, select: { id: true } });
        case 'service':
          return this.prisma.service.findFirst({ where: { id, storeId, deletedAt: null }, select: { id: true } });
        case 'addonGroup':
          return this.prisma.addonGroup.findFirst({ where: { id, storeId }, select: { id: true } });
      }
    })();

    if (found === null) {
      throw AppError.notFound(entity === 'addonGroup' ? 'Add-on group' : capitalise(entity));
    }
  }

  /**
   * Turns the unique-constraint violation on `(storeId, slug)` into something a person can
   * act on. Prisma's own message names the constraint, not the field, which helps nobody
   * looking at an admin form.
   */
  private async guardSlug<T>(entity: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.validation(
          `Another ${entity} already uses that URL slug. Slugs must be unique within a store.`,
        );
      }
      throw error;
    }
  }
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
