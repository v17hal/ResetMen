import { Injectable } from '@nestjs/common';
import type { StoreProfileInput } from '@reset/types';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';

const FIELDS = {
  id: true,
  name: true,
  slug: true,
  tagline: true,
  address: true,
  city: true,
  pincode: true,
  phone: true,
  audience: true,
} as const;

/**
 * The shop's own words — client request 14/09/2026.
 *
 * The description under the name was written into the website's code, so changing "for men"
 * or the sentence about walk-ins meant a release. It lives here instead, next to the switch
 * that says who the shop serves.
 */
@Injectable()
export class AdminStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async get(storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: FIELDS });
    if (store === null) throw AppError.notFound('Store');
    return store;
  }

  async update(storeId: string, input: StoreProfileInput) {
    await this.get(storeId);
    return this.prisma.store.update({
      where: { id: storeId },
      // Empty is not a value: a cleared box means "use the wording for the audience", which
      // is what null means everywhere downstream.
      data: {
        name: input.name,
        tagline: input.tagline === null || input.tagline === '' ? null : input.tagline,
        address: input.address,
        city: input.city,
        pincode: input.pincode,
        phone: input.phone,
        audience: input.audience,
      },
      select: FIELDS,
    });
  }
}
