import { Injectable } from '@nestjs/common';
import type { BannerInput } from '@reset/types';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Home-screen banners — client request 11/09/2026.
 *
 * The image itself is uploaded through /admin/media first; a banner is the picture's URL,
 * what it says in words, and optionally the service a tap should open.
 */
@Injectable()
export class AdminBannersService {
  constructor(private readonly prisma: PrismaService) {}

  list(storeId: string) {
    return this.prisma.banner.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        service: { select: { id: true, name: true, slug: true } },
        placementCategory: { select: { id: true, name: true } },
        placementService: { select: { id: true, name: true } },
      },
    });
  }

  async create(storeId: string, input: BannerInput) {
    await this.assertService(storeId, input.serviceId);
    await this.assertPlacement(storeId, input);
    return this.prisma.banner.create({
      data: { storeId, ...input },
      include: {
        service: { select: { id: true, name: true, slug: true } },
        placementCategory: { select: { id: true, name: true } },
        placementService: { select: { id: true, name: true } },
      },
    });
  }

  async update(storeId: string, id: string, input: BannerInput) {
    const before = await this.find(storeId, id);
    await this.assertService(storeId, input.serviceId);
    await this.assertPlacement(storeId, input);
    const after = await this.prisma.banner.update({
      where: { id },
      data: input,
      include: {
        service: { select: { id: true, name: true, slug: true } },
        placementCategory: { select: { id: true, name: true } },
        placementService: { select: { id: true, name: true } },
      },
    });
    return { before, after };
  }

  async remove(storeId: string, id: string) {
    const before = await this.find(storeId, id);
    await this.prisma.banner.delete({ where: { id } });
    return before;
  }

  private async find(storeId: string, id: string) {
    const banner = await this.prisma.banner.findFirst({ where: { id, storeId } });
    if (banner === null) throw AppError.notFound('Banner');
    return banner;
  }

  /**
   * The category or service a banner is placed on must belong to this store.
   *
   * Unlike the tap target, an unpublished one is allowed: a shop preparing a service can
   * put its banner up first, and nobody sees either until the service is published.
   */
  private async assertPlacement(storeId: string, input: BannerInput): Promise<void> {
    if (input.placement === 'CATEGORY' && input.placementCategoryId !== null) {
      const category = await this.prisma.category.findFirst({
        where: { id: input.placementCategoryId, storeId, deletedAt: null },
        select: { id: true },
      });
      if (category === null) {
        throw AppError.validation('That category does not exist.', {
          field: 'placementCategoryId',
        });
      }
    }
    if (input.placement === 'SERVICE' && input.placementServiceId !== null) {
      const service = await this.prisma.service.findFirst({
        where: { id: input.placementServiceId, storeId, deletedAt: null },
        select: { id: true },
      });
      if (service === null) {
        throw AppError.validation('That service does not exist.', {
          field: 'placementServiceId',
        });
      }
    }
  }

  /**
   * A banner that opens a deleted or unpublished service would lead a customer to a "not
   * found" page from the most prominent spot on the home screen.
   */
  private async assertService(storeId: string, serviceId: string | null): Promise<void> {
    if (serviceId === null) return;
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, storeId, deletedAt: null },
      select: { isActive: true, name: true },
    });
    if (service === null) {
      throw AppError.validation('That service does not exist.', { field: 'serviceId' });
    }
    if (!service.isActive) {
      throw AppError.validation(
        `"${service.name}" is not published, so a tap on this banner would lead nowhere. ` +
          'Publish it first, or leave the banner without a link.',
        { field: 'serviceId' },
      );
    }
  }
}
