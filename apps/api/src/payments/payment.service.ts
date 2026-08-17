import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderResponse } from '@reset/types';

import { BookingLifecycleService } from '../booking/booking-lifecycle.service.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { RazorpayClient } from './razorpay.client.js';
import type { GatewayPayment } from './razorpay.client.js';

/** Razorpay webhook events this system acts on. Anything else is recorded and ignored. */
const HANDLED_EVENTS = new Set([
  'payment.captured',
  'payment.failed',
  'payment.authorized',
  'refund.processed',
  'refund.failed',
  'order.paid',
]);

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RazorpayClient,
    private readonly lifecycle: BookingLifecycleService,
    private readonly rewards: RewardsService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Opens a checkout for a held booking or a pending product order.
   *
   * The amount is read from the row the server already wrote — never from the request.
   * Re-calling this for the same booking returns the existing open order rather than
   * creating a second one, because a customer who taps "Pay" twice should not end up with
   * two orders against one slot.
   */
  async createOrder(params: {
    storeId: string;
    userId: string;
    bookingId?: string;
    productOrderId?: string;
  }): Promise<OrderResponse> {
    const target = await this.resolveTarget(params);

    const existing = await this.prisma.payment.findFirst({
      where: {
        ...(params.bookingId === undefined
          ? { productOrderId: params.productOrderId }
          : { bookingId: params.bookingId }),
        status: { in: ['CREATED', 'AUTHORIZED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing !== null && existing.amountPaise === target.amountPaise) {
      return this.toOrderResponse(existing.id, existing.gatewayOrderId, existing, target.user);
    }

    const order = await this.gateway.createOrder({
      amountPaise: target.amountPaise,
      currency: target.currency,
      receipt: target.receipt,
      notes: target.notes,
    });

    const payment = await this.prisma.payment.create({
      data: {
        storeId: params.storeId,
        bookingId: params.bookingId ?? null,
        productOrderId: params.productOrderId ?? null,
        gateway: 'RAZORPAY',
        gatewayOrderId: order.id,
        amountPaise: target.amountPaise,
        currency: target.currency,
        status: 'CREATED',
      },
    });

    return this.toOrderResponse(payment.id, order.id, payment, target.user);
  }

  /**
   * Browser handshake after checkout returns.
   *
   * Advisory: the webhook is authoritative and will do this again. Its only job is making
   * the success screen appear without waiting for a webhook round-trip. It still verifies
   * the signature, because an unverified client claim is not evidence of anything.
   */
  async verifyHandshake(params: {
    userId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }) {
    const valid = this.gateway.verifyCheckoutSignature({
      gatewayOrderId: params.razorpayOrderId,
      gatewayPaymentId: params.razorpayPaymentId,
      signature: params.razorpaySignature,
    });

    if (!valid) {
      this.logger.warn(`Rejected a checkout handshake with a bad signature for ${params.razorpayOrderId}`);
      throw new AppError(
        'PAYMENT_FAILED',
        400,
        'Payment could not be verified',
        'The confirmation from the payment page failed verification.',
      );
    }

    const payment = await this.prisma.payment.findFirst({
      where: { gatewayOrderId: params.razorpayOrderId },
    });
    if (payment === null) throw AppError.notFound('Payment');

    await this.capture(payment.id, params.razorpayPaymentId, null, 'handshake');

    return this.statusOf(payment.id);
  }

  /**
   * Webhook entry point. Razorpay retries until it gets a 2xx, so this must be idempotent
   * and must not return a non-2xx for anything it has already handled.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined, eventIdHeader?: string) {
    if (signature === undefined || signature.length === 0) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 400, 'Missing signature');
    }

    if (!this.gateway.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Rejected a webhook with an invalid signature');
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 400, 'Signature verification failed');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookPayload;
    const eventId = eventIdHeader ?? `${payload.event}:${payload.created_at}`;

    // The unique index on eventId is what makes a retried delivery a no-op. Doing this
    // before any state change means a duplicate can never double-refund or double-confirm.
    try {
      await this.prisma.paymentEvent.create({
        data: {
          gateway: 'RAZORPAY',
          eventId,
          eventType: payload.event,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(`Webhook ${eventId} already processed — acknowledging duplicate`);
        return { received: true, duplicate: true };
      }
      throw error;
    }

    if (!HANDLED_EVENTS.has(payload.event)) {
      await this.markEventProcessed(eventId);
      return { received: true, duplicate: false, ignored: payload.event };
    }

    try {
      await this.dispatch(payload);
      await this.markEventProcessed(eventId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Webhook ${eventId} (${payload.event}) failed: ${message}`);

      await this.prisma.paymentEvent.update({
        where: { eventId },
        data: { processingError: message },
      });

      // Deliberately swallowed. A non-2xx makes Razorpay retry, and the retry would be
      // deduped by the row already written above — so it would never succeed. The stored
      // processingError is what the reconciliation job and a human look at instead.
    }

    return { received: true, duplicate: false };
  }

  private async dispatch(payload: RazorpayWebhookPayload): Promise<void> {
    switch (payload.event) {
      case 'payment.authorized':
      case 'payment.captured':
      case 'order.paid': {
        const entity = payload.payload.payment?.entity;
        if (entity === undefined) return;

        const payment = await this.prisma.payment.findFirst({
          where: { gatewayOrderId: entity.order_id ?? '' },
        });
        if (payment === null) {
          this.logger.warn(`Webhook for unknown order ${entity.order_id}`);
          return;
        }

        if (payload.event === 'payment.authorized') {
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'AUTHORIZED', gatewayPaymentId: entity.id, method: entity.method ?? null },
          });
          return;
        }

        await this.capture(payment.id, entity.id, entity, 'webhook');
        return;
      }

      case 'payment.failed': {
        const entity = payload.payload.payment?.entity;
        if (entity === undefined) return;

        await this.prisma.payment.updateMany({
          where: { gatewayOrderId: entity.order_id ?? '', status: { in: ['CREATED', 'AUTHORIZED'] } },
          data: {
            status: 'FAILED',
            gatewayPaymentId: entity.id,
            failureReason: entity.error_description ?? 'Payment failed at the gateway',
          },
        });

        // The hold is deliberately left alone: it still has time on its TTL, and the
        // customer will usually retry with another card within seconds. Expiry sweeps it.
        return;
      }

      case 'refund.processed':
      case 'refund.failed': {
        const entity = payload.payload.refund?.entity;
        if (entity === undefined) return;

        await this.prisma.refund.updateMany({
          where: { gatewayRefundId: entity.id },
          data: { status: payload.event === 'refund.processed' ? 'PROCESSED' : 'FAILED' },
        });
        return;
      }

      default:
        return;
    }
  }

  /**
   * Marks a payment captured and confirms whatever it was paying for.
   *
   * Idempotent at every step: a second call finds the payment already CAPTURED and returns,
   * and `lifecycle.confirm` is itself idempotent.
   */
  private async capture(
    paymentId: string,
    gatewayPaymentId: string,
    entity: GatewayPayment | null,
    via: 'webhook' | 'handshake' | 'reconciliation',
  ): Promise<void> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

    if (payment.status === 'CAPTURED' || payment.status === 'REFUNDED') {
      return;
    }

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'CAPTURED',
        gatewayPaymentId,
        method: entity?.method ?? payment.method,
        rawPayload: entity === null ? undefined : (entity as unknown as Prisma.InputJsonValue),
      },
    });

    this.logger.log(`Payment ${paymentId} captured via ${via}`);

    if (payment.bookingId !== null) {
      await this.confirmBooking(payment.bookingId, paymentId);
      return;
    }

    if (payment.productOrderId !== null) {
      await this.prisma.productOrder.update({
        where: { id: payment.productOrderId },
        data: { status: 'PAID' },
      });
    }
  }

  /**
   * Confirms the booking a captured payment belongs to.
   *
   * The interesting case is the losing one: payment succeeded *after* the hold lapsed. The
   * slot may already belong to someone else, so the booking is not resurrected — the money
   * goes back instead, automatically, without anyone having to notice.
   */
  private async confirmBooking(bookingId: string, paymentId: string): Promise<void> {
    try {
      await this.lifecycle.confirm(bookingId, null);
    } catch (error) {
      if (error instanceof AppError && error.code === 'HOLD_EXPIRED') {
        this.logger.warn(`Payment ${paymentId} landed after hold ${bookingId} expired — refunding`);
        await this.refund({
          paymentId,
          reason: 'Hold expired before payment completed',
          adminId: null,
        });
        return;
      }
      throw error;
    }

    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { store: { select: { timezone: true } } },
    });

    // The applied reward was already claimed at hold time, so there is nothing to consume
    // here. Payment is what makes that claim permanent: from this point the expiry and
    // cancellation paths no longer hand it back.
    if (booking.userId !== null) {
      await this.rewards.onBookingConfirmed(booking.storeId, booking.userId, bookingId);
      await this.notifications.notifyBookingConfirmed(bookingId);
    }
  }

  /**
   * Refund, full or partial.
   *
   * Refuses to exceed what is left, which is the only guard that matters here — two
   * managers each issuing a "full" refund an hour apart would otherwise send the money
   * twice.
   */
  async refund(params: {
    paymentId: string;
    amountPaise?: number;
    reason?: string;
    adminId: string | null;
  }) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: params.paymentId },
      include: { refunds: true },
    });

    if (payment.status !== 'CAPTURED' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw new AppError(
        'PAYMENT_NOT_REFUNDABLE',
        409,
        'Nothing to refund',
        `This payment is ${payment.status.toLowerCase()}.`,
      );
    }

    if (payment.gatewayPaymentId === null) {
      throw new AppError(
        'PAYMENT_NOT_REFUNDABLE',
        409,
        'Nothing to refund',
        'No gateway payment is recorded against this order.',
      );
    }

    const alreadyRefunded = payment.refunds
      .filter((r) => r.status !== 'FAILED')
      .reduce((sum, r) => sum + r.amountPaise, 0);
    const remaining = payment.amountPaise - alreadyRefunded;

    const amountPaise = params.amountPaise ?? remaining;

    if (amountPaise <= 0 || amountPaise > remaining) {
      throw new AppError(
        'PAYMENT_NOT_REFUNDABLE',
        422,
        'Refund amount is out of range',
        `At most ₹${(remaining / 100).toFixed(2)} can still be refunded.`,
        { remainingPaise: remaining },
      );
    }

    const gatewayRefund = await this.gateway.refund({
      gatewayPaymentId: payment.gatewayPaymentId,
      amountPaise,
      notes: { reason: params.reason ?? 'Refund issued from the RESET admin panel' },
    });

    const totalRefunded = alreadyRefunded + amountPaise;

    const [refund] = await this.prisma.$transaction([
      this.prisma.refund.create({
        data: {
          paymentId: payment.id,
          gatewayRefundId: gatewayRefund.id,
          amountPaise,
          status: gatewayRefund.status === 'processed' ? 'PROCESSED' : 'PENDING',
          reason: params.reason ?? null,
          initiatedBy: params.adminId,
        },
      }),
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: totalRefunded >= payment.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        },
      }),
    ]);

    this.logger.log(`Refunded ${amountPaise} paise against payment ${payment.id}`);

    return {
      refundId: refund.id,
      amountPaise,
      status: refund.status,
      remainingPaise: payment.amountPaise - totalRefunded,
    };
  }

  /**
   * Capture discovered by the reconciliation job rather than announced by a webhook.
   *
   * Same path as every other capture — the job's job is only to notice, not to invent a
   * second way of settling money.
   */
  async reconcileCapture(paymentId: string, entity: GatewayPayment): Promise<void> {
    await this.capture(paymentId, entity.id, entity, 'reconciliation');
  }

  /** Re-runs confirmation for a payment already marked CAPTURED. Idempotent. */
  async settleCapturedBooking(paymentId: string, bookingId: string): Promise<void> {
    await this.confirmBooking(bookingId, paymentId);
  }

  async statusOf(paymentId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { refunds: true },
    });

    return {
      id: payment.id,
      status: payment.status,
      amountPaise: payment.amountPaise,
      refundedPaise: payment.refunds
        .filter((r) => r.status !== 'FAILED')
        .reduce((sum, r) => sum + r.amountPaise, 0),
      method: payment.method,
      gatewayPaymentId: payment.gatewayPaymentId,
      bookingId: payment.bookingId,
      productOrderId: payment.productOrderId,
      createdAt: payment.createdAt.toISOString(),
    };
  }

  /**
   * Development-only shortcut that completes a payment without a gateway.
   *
   * The controller exposing this refuses to exist in production; it is what makes the
   * booking → payment → QR → check-in path demonstrable to the client before their
   * Razorpay account is live.
   */
  async simulateSuccess(paymentId: string) {
    if (!this.gateway.simulated) {
      throw AppError.validation('Simulation is disabled when real Razorpay credentials are set.');
    }

    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const fakePaymentId = `pay_sim${payment.id.replace(/-/g, '').slice(0, 14)}`;

    await this.capture(payment.id, fakePaymentId, null, 'handshake');

    return {
      ...(await this.statusOf(payment.id)),
      simulatedSignature: this.gateway.signCheckout(payment.gatewayOrderId, fakePaymentId),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async resolveTarget(params: {
    storeId: string;
    userId: string;
    bookingId?: string;
    productOrderId?: string;
  }) {
    if (params.bookingId !== undefined) {
      // `userId: null` is included deliberately. A hold made before signing in belongs to
      // nobody yet — that is the whole point of the anonymous hold on POST /bookings/hold,
      // which exists so nobody loses a slot while they go and find their phone. Without
      // this, such a booking can never be paid for and the slot simply expires.
      const booking = await this.prisma.booking.findFirst({
        where: {
          id: params.bookingId,
          storeId: params.storeId,
          OR: [{ userId: params.userId }, { userId: null }],
        },
        include: {
          user: { select: { name: true, phone: true, email: true } },
          store: { include: { settings: { select: { currency: true } } } },
        },
      });
      if (booking === null) throw AppError.notFound('Booking');

      if (booking.status !== 'HELD') {
        throw AppError.validation(
          booking.status === 'CONFIRMED'
            ? 'This booking is already paid for.'
            : `A booking that is ${booking.status} cannot be paid for.`,
        );
      }

      if (booking.holdExpiresAt !== null && booking.holdExpiresAt < new Date()) {
        throw new AppError(
          'HOLD_EXPIRED',
          410,
          'Your hold expired',
          'The slot was released. Please pick a time again.',
        );
      }

      /**
       * Claim an unowned hold for whoever is paying for it.
       *
       * A conditional UPDATE, not a read-then-write: `userId: null` in the WHERE clause
       * means this is a no-op the moment the booking already has an owner, so two people
       * racing on the same id cannot take it from each other. A booking already belonging
       * to somebody else was never selected above.
       *
       * Claimed before the gateway call, so the row is already owned if the payment
       * succeeds — the alternative leaves a captured payment attached to a booking with no
       * customer, which is the hardest kind of mismatch to unpick afterwards.
       */
      let user = booking.user;

      if (booking.userId === null) {
        await this.prisma.booking.updateMany({
          where: { id: booking.id, userId: null, status: 'HELD' },
          data: { userId: params.userId },
        });

        user = await this.prisma.user.findUnique({
          where: { id: params.userId },
          select: { name: true, phone: true, email: true },
        });
      }

      return {
        amountPaise: booking.payablePaise,
        currency: booking.store.settings?.currency ?? 'INR',
        receipt: booking.publicId,
        notes: { bookingId: booking.id, publicId: booking.publicId } as Record<string, string>,
        user,
      };
    }

    const order = await this.prisma.productOrder.findFirst({
      where: { id: params.productOrderId, storeId: params.storeId, userId: params.userId },
      include: {
        user: { select: { name: true, phone: true, email: true } },
        store: { include: { settings: { select: { currency: true } } } },
      },
    });
    if (order === null) throw AppError.notFound('Order');

    if (order.status !== 'PENDING') {
      throw AppError.validation(`An order that is ${order.status} cannot be paid for.`);
    }

    return {
      amountPaise: order.totalPaise,
      currency: order.store.settings?.currency ?? 'INR',
      receipt: order.publicId,
      notes: { productOrderId: order.id, publicId: order.publicId },
      user: order.user,
    };
  }

  private toOrderResponse(
    paymentId: string,
    gatewayOrderId: string,
    payment: { amountPaise: number; currency: string },
    // `phone` is nullable since sign-in moved to Google. Razorpay treats prefill fields as
    // hints, so a missing contact means one more field for the customer to type — not a
    // failed checkout.
    user: { name: string | null; phone: string | null; email: string | null } | null,
  ): OrderResponse {
    return {
      paymentId,
      gatewayOrderId,
      keyId: this.gateway.publishableKey,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      simulated: this.gateway.simulated,
      prefill: {
        name: user?.name ?? null,
        contact: user?.phone ?? null,
        email: user?.email ?? null,
      },
    };
  }

  private async markEventProcessed(eventId: string): Promise<void> {
    await this.prisma.paymentEvent.update({
      where: { eventId },
      data: { processedAt: new Date() },
    });
  }
}

interface RazorpayWebhookPayload {
  readonly event: string;
  readonly created_at: number;
  readonly payload: {
    readonly payment?: { readonly entity: GatewayPayment };
    readonly refund?: { readonly entity: { id: string; payment_id: string; amount: number } };
  };
}
