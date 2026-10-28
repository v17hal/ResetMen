import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { loadEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';

/** How long an unpaid order may hold its stock. Generous — nothing else wants the shelf. */
const ABANDON_AFTER_MINUTES = 30;

@Injectable()
export class ProductJobs {
  private readonly logger = new Logger(ProductJobs.name);

  /**
   * Whether an unpaid order is an abandoned cart.
   *
   * With a gateway it is: the customer left the checkout and the stock should go back. With
   * money taken at the counter it is not — the order is a reservation, and the customer is
   * expected to walk in later and pay for it. Cancelling those after half an hour is how
   * every order the store ever took quietly disappeared before anyone could collect it.
   */
  private readonly paymentsEnabled = loadEnv().PAYMENTS_ENABLED;

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
    if (!this.paymentsEnabled) return;

    const cutoff = new Date(Date.now() - ABANDON_AFTER_MINUTES * 60_000);

    const abandoned = await this.prisma.productOrder.findMany({
      // Only orders where an online payment was started and never finished. A counter
      // order has no gateway payment at all — it is a reservation the customer will pay for
      // on arrival — and before customers could choose, switching online payment on would
      // have cancelled every one of them half an hour after it was placed.
      where: {
        status: 'PENDING',
        createdAt: { lt: cutoff },
        payment: { is: { gateway: 'RAZORPAY', status: { not: 'CAPTURED' } } },
      },
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
