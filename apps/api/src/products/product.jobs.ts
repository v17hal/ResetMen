import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../database/prisma.service.js';

/** How long an unpaid order may hold its stock. Generous — nothing else wants the shelf. */
const ABANDON_AFTER_MINUTES = 30;

@Injectable()
export class ProductJobs {
  private readonly logger = new Logger(ProductJobs.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns stock held by orders that were never paid for.
   *
   * Stock is decremented when the order is created, so without this an abandoned cart takes
   * the last tub of balm off the shelf permanently — and the first anyone notices is the
   * storefront claiming to be sold out of something visibly sitting on the counter.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'release-abandoned-orders' })
  async releaseAbandonedOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - ABANDON_AFTER_MINUTES * 60_000);

    const abandoned = await this.prisma.productOrder.findMany({
      where: { status: 'PENDING', createdAt: { lt: cutoff } },
      include: { items: true, payment: { select: { status: true } } },
      take: 100,
    });

    let released = 0;

    for (const order of abandoned) {
      // A captured payment that has not yet been reflected on the order is the
      // reconciliation job's business, not this one's. Leave it alone.
      if (order.payment?.status === 'CAPTURED') continue;

      await this.prisma.$transaction(async (tx) => {
        const cancelled = await tx.productOrder.updateMany({
          where: { id: order.id, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
        if (cancelled.count === 0) return;

        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQty: { increment: item.qty } },
          });
        }

        released += 1;
      });
    }

    if (released > 0) {
      this.logger.log(`Returned stock from ${released} abandoned order(s)`);
    }
  }
}
