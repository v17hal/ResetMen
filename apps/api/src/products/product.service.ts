import { Injectable, Logger } from '@nestjs/common';
import type { CreateProductOrderRequest } from '@reset/types';

import { generatePublicId } from '../booking/public-id.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationService } from '../notifications/notification.service.js';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Storefront listing.
   *
   * Stock is exposed as a boolean, never a count. "Only 2 left" is a nice cue and a free
   * gift to anyone who wants to know exactly how the shelf is doing.
   */
  async list(storeId: string) {
    const products = await this.prisma.product.findMany({
      where: { storeId, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      images: (p.images as string[] | null) ?? [],
      pricePaise: p.pricePaise,
      mrpPaise: p.mrpPaise,
      inStock: p.stockQty > 0,
      sku: p.sku,
    }));
  }

  async detail(storeId: string, slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { storeId, slug, isActive: true, deletedAt: null },
    });
    if (product === null) throw AppError.notFound('Product');

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      images: (product.images as string[] | null) ?? [],
      pricePaise: product.pricePaise,
      mrpPaise: product.mrpPaise,
      inStock: product.stockQty > 0,
      sku: product.sku,
    };
  }

  /**
   * Creates a pending order and decrements stock in the same transaction.
   *
   * Stock is taken at order time rather than at payment, for the same reason a slot is
   * held rather than sold at checkout: two people buying the last tub of balm must not both
   * reach the payment screen. The decrement is a guarded conditional update, so the read
   * that decided there was stock cannot go stale between deciding and writing.
   *
   * An order that is never paid for gives the stock back — see `ProductJobs`.
   */
  async createOrder(params: {
    storeId: string;
    userId: string;
    input: CreateProductOrderRequest;
  }) {
    const productIds = params.input.items.map((item) => item.productId);

    // Merge duplicate lines up front. Two lines of the same product would otherwise each
    // pass their own stock check and together oversell it.
    const quantities = new Map<string, number>();
    for (const item of params.input.items) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.qty);
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, storeId: params.storeId, isActive: true, deletedAt: null },
    });

    if (products.length !== quantities.size) {
      throw AppError.notFound('Product');
    }

    return this.prisma.$transaction(async (tx) => {
      let totalPaise = 0;
      const lines: {
        productId: string;
        nameSnapshot: string;
        unitPricePaise: number;
        qty: number;
      }[] = [];

      for (const product of products) {
        const qty = quantities.get(product.id) ?? 0;

        const taken = await tx.$executeRaw`
          UPDATE products
             SET "stockQty" = "stockQty" - ${qty}
           WHERE id = ${product.id}::uuid
             AND "stockQty" >= ${qty}
        `;

        if (taken !== 1) {
          throw new AppError(
            'OUT_OF_STOCK',
            409,
            'Out of stock',
            `"${product.name}" does not have ${qty} left.`,
            { productId: product.id },
          );
        }

        totalPaise += product.pricePaise * qty;
        lines.push({
          productId: product.id,
          // Snapshot: a price change tomorrow must not rewrite today's receipt.
          nameSnapshot: product.name,
          unitPricePaise: product.pricePaise,
          qty,
        });
      }

      const order = await tx.productOrder.create({
        data: {
          publicId: generatePublicId(),
          storeId: params.storeId,
          userId: params.userId,
          status: 'PENDING',
          totalPaise,
          items: { create: lines },
        },
        include: { items: true },
      });

      return this.toDto(order);
    });
  }

  async listOrders(userId: string, limit: number) {
    const orders = await this.prisma.productOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { items: true },
    });

    return orders.map((o) => this.toDto(o));
  }

  async orderDetail(orderId: string, userId: string) {
    const order = await this.prisma.productOrder.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (order === null) throw AppError.notFound('Order');

    return this.toDto(order);
  }

  /**
   * Counter-side status change.
   *
   * Cancelling returns the stock to the shelf — the one transition here that has to do
   * more than set a column.
   */
  async setOrderStatus(params: {
    storeId: string;
    orderId: string;
    status: 'READY_FOR_PICKUP' | 'PICKED_UP' | 'CANCELLED';
    reason?: string;
  }) {
    const order = await this.prisma.productOrder.findFirst({
      where: { id: params.orderId, storeId: params.storeId },
      include: { items: true },
    });
    if (order === null) throw AppError.notFound('Order');

    if (order.status === 'PICKED_UP' || order.status === 'CANCELLED') {
      throw AppError.validation(`This order is already ${order.status.toLowerCase()}.`);
    }

    if (params.status === 'READY_FOR_PICKUP' && order.status !== 'PAID') {
      throw AppError.validation('Only a paid order can be marked ready for pickup.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productOrder.update({
        where: { id: order.id },
        data: { status: params.status },
      });

      if (params.status === 'CANCELLED') {
        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQty: { increment: item.qty } },
          });
        }
      }
    });

    if (params.status === 'READY_FOR_PICKUP') {
      await this.notifications.notifyOrderReady(order.userId, order.id, order.publicId);
    }

    this.logger.log(`Order ${order.publicId} → ${params.status}`);
    return { orderId: order.id, status: params.status };
  }

  private toDto(order: {
    id: string;
    publicId: string;
    status: string;
    totalPaise: number;
    createdAt: Date;
    items: { productId: string; nameSnapshot: string; unitPricePaise: number; qty: number }[];
  }) {
    return {
      id: order.id,
      publicId: order.publicId,
      status: order.status,
      totalPaise: order.totalPaise,
      createdAt: order.createdAt.toISOString(),
      items: order.items.map((i) => ({
        productId: i.productId,
        name: i.nameSnapshot,
        unitPricePaise: i.unitPricePaise,
        qty: i.qty,
        linePaise: i.unitPricePaise * i.qty,
      })),
    };
  }
}
