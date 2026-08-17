import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProductInput, ProductOrderStatus } from '@reset/types';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class AdminProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(storeId: string) {
    return this.prisma.product.findMany({
      where: { storeId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(storeId: string, input: ProductInput) {
    try {
      return await this.prisma.product.create({ data: { storeId, ...input } });
    } catch (error) {
      throw this.slugError(error);
    }
  }

  async update(storeId: string, id: string, input: ProductInput) {
    const before = await this.find(storeId, id);

    try {
      // `stockQty` is deliberately excluded: it moves through `adjustStock`, which applies
      // a delta. Letting a stale edit form post an absolute count would silently undo every
      // sale made while the form was open.
      const { stockQty: _ignored, ...rest } = input;
      const after = await this.prisma.product.update({ where: { id }, data: rest });
      return { before, after };
    } catch (error) {
      throw this.slugError(error);
    }
  }

  /**
   * Applies a signed delta, refusing to go negative.
   *
   * Written as a conditional UPDATE so a correction and a sale landing together cannot
   * interleave into a negative shelf.
   */
  async adjustStock(storeId: string, id: string, delta: number) {
    const product = await this.find(storeId, id);

    const applied = await this.prisma.$executeRaw`
      UPDATE products
         SET "stockQty" = "stockQty" + ${delta}
       WHERE id = ${id}::uuid
         AND "stockQty" + ${delta} >= 0
    `;

    if (applied !== 1) {
      throw AppError.validation(
        `That would take "${product.name}" below zero. It currently has ${product.stockQty}.`,
        { stockQty: product.stockQty },
      );
    }

    const after = await this.prisma.product.findUniqueOrThrow({ where: { id } });

    return { productId: id, before: product.stockQty, after: after.stockQty, delta };
  }

  async softDelete(storeId: string, id: string) {
    const product = await this.find(storeId, id);

    const pending = await this.prisma.productOrderItem.count({
      where: { productId: id, productOrder: { status: { in: ['PENDING', 'PAID', 'READY_FOR_PICKUP'] } } },
    });

    if (pending > 0) {
      throw AppError.validation(
        `"${product.name}" is on ${pending} order(s) that have not been collected yet.`,
      );
    }

    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    return product;
  }

  async listOrders(storeId: string, status: ProductOrderStatus | undefined, limit: number) {
    const orders = await this.prisma.productOrder.findMany({
      where: { storeId, ...(status === undefined ? {} : { status }) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        items: true,
        user: { select: { name: true, phone: true } },
        payment: { select: { status: true } },
      },
    });

    return orders.map((order) => ({
      id: order.id,
      publicId: order.publicId,
      status: order.status,
      totalPaise: order.totalPaise,
      paymentStatus: order.payment?.status ?? null,
      customerName:
        order.user.name ??
        (order.user.phone === null ? 'Guest' : `Guest ${order.user.phone.slice(-4)}`),
      customerPhone: order.user.phone,
      createdAt: order.createdAt.toISOString(),
      items: order.items.map((i) => ({
        name: i.nameSnapshot,
        qty: i.qty,
        unitPricePaise: i.unitPricePaise,
      })),
    }));
  }

  private async find(storeId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, storeId, deletedAt: null },
    });
    if (product === null) throw AppError.notFound('Product');
    return product;
  }

  private slugError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return AppError.validation('Another product already uses that URL slug.');
    }
    return error;
  }
}
