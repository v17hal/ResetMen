import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../database/prisma.service.js';
import { PaymentService } from './payment.service.js';
import { RazorpayClient } from './razorpay.client.js';

/** How long a payment may sit unresolved before the job goes and asks the gateway. */
const STALE_AFTER_MINUTES = 15;

/**
 * Payment reconciliation.
 *
 * Webhooks get lost. Not often, but often enough that a system which trusts them
 * completely will, sooner or later, take someone's money and give them nothing — and the
 * first anyone hears of it is an angry customer at the counter with a bank SMS.
 *
 * This job is the answer to that: it asks the gateway what actually happened rather than
 * waiting to be told.
 */
@Injectable()
export class PaymentJobs {
  private readonly logger = new Logger(PaymentJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly gateway: RazorpayClient,
  ) {}

  /**
   * Resolve payments the gateway never told us about.
   *
   * Catches the lost-webhook case in both directions: money taken with no booking
   * confirmed, and a checkout abandoned that is still holding a payment row open.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'reconcile-payments' })
  async reconcilePending(): Promise<void> {
    if (this.gateway.simulated) return;

    const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000);

    const stale = await this.prisma.payment.findMany({
      where: { status: { in: ['CREATED', 'AUTHORIZED'] }, createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    if (stale.length === 0) return;

    let resolved = 0;

    for (const payment of stale) {
      try {
        const attempts = await this.gateway.fetchPaymentsForOrder(payment.gatewayOrderId);
        const captured = attempts.find((p) => p.status === 'captured');

        if (captured !== undefined) {
          this.logger.warn(
            `Payment ${payment.id} was captured at the gateway but never reached us — reconciling`,
          );
          await this.payments.reconcileCapture(payment.id, captured);
          resolved += 1;
          continue;
        }

        // Nothing captured and the hold is long gone. Close the row so it stops being
        // scanned every ten minutes for the rest of time.
        const abandoned = attempts.every((p) => p.status === 'failed') || attempts.length === 0;
        if (abandoned && payment.createdAt < new Date(Date.now() - 6 * 3_600_000)) {
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'FAILED', failureReason: 'Abandoned at checkout' },
          });
          resolved += 1;
        }
      } catch (error) {
        this.logger.error(
          `Reconciliation failed for payment ${payment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (resolved > 0) this.logger.log(`Reconciled ${resolved} payment(s)`);
  }

  /**
   * Captured payment, unconfirmed booking.
   *
   * The narrow window where the capture landed but confirmation failed afterwards — a
   * database blip, a crash between the two writes. Cheap to check, and the failure it
   * catches is the single worst one in the system.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'confirm-paid-bookings' })
  async confirmPaidButUnconfirmed(): Promise<void> {
    const orphans = await this.prisma.payment.findMany({
      where: {
        status: 'CAPTURED',
        booking: { status: { in: ['HELD', 'EXPIRED'] } },
      },
      select: { id: true, bookingId: true },
      take: 50,
    });

    for (const payment of orphans) {
      if (payment.bookingId === null) continue;

      this.logger.warn(
        `Booking ${payment.bookingId} is paid but unconfirmed — settling from payment ${payment.id}`,
      );

      try {
        await this.payments.settleCapturedBooking(payment.id, payment.bookingId);
      } catch (error) {
        this.logger.error(
          `Could not settle booking ${payment.bookingId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * Webhook deliveries that threw while being processed.
   *
   * They are never retried by Razorpay — the dedupe row means a retry would be discarded —
   * so this is the only thing that will ever look at them again.
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'report-failed-webhooks' })
  async reportFailedWebhooks(): Promise<void> {
    const failures = await this.prisma.paymentEvent.count({
      where: { processedAt: null, processingError: { not: null } },
    });

    if (failures > 0) {
      this.logger.error(
        `${failures} webhook event(s) failed processing and will not be retried by the gateway. ` +
          'Inspect payment_events.processing_error.',
      );
    }
  }
}
