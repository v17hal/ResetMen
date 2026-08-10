import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AvailabilityService } from '../../src/availability/availability.service.js';
import { ScheduleResolverService } from '../../src/availability/schedule-resolver.service.js';
import { BookingLifecycleService } from '../../src/booking/booking-lifecycle.service.js';
import { BookingService } from '../../src/booking/booking.service.js';
import { CheckinService } from '../../src/checkin/checkin.service.js';
import { AppError } from '../../src/common/errors.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import {
  EmailProvider,
  SmsProvider,
  WhatsAppProvider,
} from '../../src/notifications/channel.providers.js';
import { FcmProvider } from '../../src/notifications/fcm.provider.js';
import { NotificationService } from '../../src/notifications/notification.service.js';
import { PaymentService } from '../../src/payments/payment.service.js';
import { RazorpayClient } from '../../src/payments/razorpay.client.js';
import { ProductService } from '../../src/products/product.service.js';
import { RewardsService } from '../../src/rewards/rewards.service.js';
import { ScratchService } from '../../src/rewards/scratch.service.js';
import { StreakService } from '../../src/rewards/streak.service.js';

/**
 * Money, rewards and stock — the three things in this system where a race condition costs
 * somebody something real.
 *
 * Run against a real PostgreSQL, because every guarantee tested here is enforced by a
 * conditional UPDATE or a constraint. Mocking the database would test the mock.
 *
 * Payments run in the client's simulated mode (no Razorpay credentials in `.env`), which is
 * the same code path the real gateway takes right up to the HTTP call.
 */
describe('payments, rewards and stock', () => {
  let moduleRef: TestingModule;
  let bookings: BookingService;
  let payments: PaymentService;
  let rewards: RewardsService;
  let scratch: ScratchService;
  let products: ProductService;
  let lifecycle: BookingLifecycleService;
  let gateway: RazorpayClient;

  const raw = new PrismaClient();
  let storeId: string;
  let timezone: string;
  let headServiceId: string;
  let userId: string;
  let date: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ScheduleResolverService,
        AvailabilityService,
        BookingService,
        BookingLifecycleService,
        CheckinService,
        PaymentService,
        RazorpayClient,
        RewardsService,
        ScratchService,
        StreakService,
        NotificationService,
        FcmProvider,
        SmsProvider,
        WhatsAppProvider,
        EmailProvider,
        ProductService,
      ],
    }).compile();

    await moduleRef.get(PrismaService).$connect();
    bookings = moduleRef.get(BookingService);
    payments = moduleRef.get(PaymentService);
    rewards = moduleRef.get(RewardsService);
    scratch = moduleRef.get(ScratchService);
    products = moduleRef.get(ProductService);
    lifecycle = moduleRef.get(BookingLifecycleService);
    gateway = moduleRef.get(RazorpayClient);

    const store = await raw.store.findFirstOrThrow({ where: { slug: 'reset-satellite' } });
    storeId = store.id;
    timezone = store.timezone;

    headServiceId = (await raw.service.findFirstOrThrow({ where: { storeId, slug: 'head' } })).id;

    const user = await raw.user.upsert({
      where: { phone: '+919000000001' },
      create: { phone: '+919000000001', name: 'Payment Test' },
      update: {},
    });
    userId = user.id;

    let cursor = DateTime.now().setZone(timezone).plus({ days: 1 }).startOf('day');
    while (cursor.weekday === 1) cursor = cursor.plus({ days: 1 });
    date = cursor.toISODate()!;
  });

  afterAll(async () => {
    await raw.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await raw.refund.deleteMany({});
    await raw.payment.deleteMany({});
    await raw.paymentEvent.deleteMany({});
    await raw.bookingStatusHistory.deleteMany({});
    await raw.checkinToken.deleteMany({});
    await raw.bookingAddon.deleteMany({});
    await raw.scratchCard.deleteMany({});
    await raw.booking.deleteMany({});
    await raw.userReward.deleteMany({});
    await raw.scratchReward.deleteMany({});
    await raw.scratchCampaign.deleteMany({});
    await raw.productOrderItem.deleteMany({});
    await raw.productOrder.deleteMany({});
    await raw.product.deleteMany({});
  });

  async function hold(rewardId: string | null = null, hour = 11) {
    const startsAt = DateTime.fromISO(date, { zone: timezone })
      .set({ hour, minute: 0 })
      .toISO()!;

    return bookings.hold({
      storeId,
      serviceId: headServiceId,
      addonOptionIds: [],
      startsAt,
      userId,
      rewardId,
      source: 'WEB',
    });
  }

  async function grantFlatOff(paise: number) {
    return rewards.grant({
      userId,
      storeId,
      source: 'MANUAL',
      rewardType: 'FLAT_OFF',
      rewardValue: paise,
      validityDays: 30,
    });
  }

  // ── Payment happy path ─────────────────────────────────────────────────────

  describe('checkout', () => {
    it('confirms the booking and issues a QR when payment is captured', async () => {
      const held = await hold();

      const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });
      expect(order.amountPaise).toBe(held.pricing.payablePaise);
      expect(order.simulated).toBe(true);

      await payments.simulateSuccess(order.paymentId);

      const booking = await raw.booking.findUniqueOrThrow({
        where: { id: held.bookingId },
        include: { checkinToken: true },
      });

      expect(booking.status).toBe('CONFIRMED');
      expect(booking.holdExpiresAt).toBeNull();
      // The QR is what the customer shows at the counter — a confirmed booking without one
      // is a customer standing at the desk with nothing to scan.
      expect(booking.checkinToken).not.toBeNull();
    });

    it('reuses the open order when the customer taps Pay twice', async () => {
      const held = await hold();

      const first = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });
      const second = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });

      expect(second.paymentId).toBe(first.paymentId);
      expect(await raw.payment.count({ where: { bookingId: held.bookingId } })).toBe(1);
    });

    it('refuses to open a checkout for a booking that is already paid', async () => {
      const held = await hold();
      const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });
      await payments.simulateSuccess(order.paymentId);

      await expect(
        payments.createOrder({ storeId, userId, bookingId: held.bookingId }),
      ).rejects.toThrow(AppError);
    });

    it('refuses to open a checkout for someone else’s booking', async () => {
      const held = await hold();
      const other = await raw.user.upsert({
        where: { phone: '+919000000002' },
        create: { phone: '+919000000002' },
        update: {},
      });

      await expect(
        payments.createOrder({ storeId, userId: other.id, bookingId: held.bookingId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('captures only once when the webhook arrives after the browser handshake', async () => {
      const held = await hold();
      const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });

      await payments.simulateSuccess(order.paymentId);
      await payments.simulateSuccess(order.paymentId);

      const history = await raw.bookingStatusHistory.count({
        where: { bookingId: held.bookingId, toStatus: 'CONFIRMED' },
      });
      expect(history).toBe(1);
    });
  });

  // ── Webhook ────────────────────────────────────────────────────────────────

  describe('webhook', () => {
    function signed(body: unknown): { raw: Buffer; signature: string } {
      const rawBody = Buffer.from(JSON.stringify(body));
      const signature = createHmac('sha256', 'simulated-razorpay-secret')
        .update(rawBody)
        .digest('hex');
      return { raw: rawBody, signature };
    }

    it('rejects a forged signature', async () => {
      const { raw: body } = signed({ event: 'payment.captured', created_at: 1, payload: {} });

      await expect(
        payments.handleWebhook(body, 'deadbeef', 'evt_forged'),
      ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    });

    it('rejects a missing signature', async () => {
      const { raw: body } = signed({ event: 'payment.captured', created_at: 1, payload: {} });

      await expect(payments.handleWebhook(body, undefined, 'evt_none')).rejects.toMatchObject({
        code: 'WEBHOOK_SIGNATURE_INVALID',
      });
    });

    it('confirms a booking from a genuine captured event', async () => {
      const held = await hold();
      const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });

      const { raw: body, signature } = signed({
        event: 'payment.captured',
        created_at: 1,
        payload: {
          payment: {
            entity: {
              id: 'pay_webhook_1',
              order_id: order.gatewayOrderId,
              status: 'captured',
              amount: order.amountPaise,
              method: 'upi',
            },
          },
        },
      });

      const result = await payments.handleWebhook(body, signature, 'evt_capture_1');
      expect(result).toMatchObject({ received: true, duplicate: false });

      const booking = await raw.booking.findUniqueOrThrow({ where: { id: held.bookingId } });
      expect(booking.status).toBe('CONFIRMED');
    });

    it('treats a redelivered event as a no-op', async () => {
      const held = await hold();
      const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });

      const { raw: body, signature } = signed({
        event: 'payment.captured',
        created_at: 1,
        payload: {
          payment: {
            entity: {
              id: 'pay_webhook_2',
              order_id: order.gatewayOrderId,
              status: 'captured',
              amount: order.amountPaise,
            },
          },
        },
      });

      await payments.handleWebhook(body, signature, 'evt_dup');
      const second = await payments.handleWebhook(body, signature, 'evt_dup');

      // Razorpay retries until it gets a 2xx. A duplicate must acknowledge, not error.
      expect(second).toMatchObject({ received: true, duplicate: true });
      expect(
        await raw.bookingStatusHistory.count({
          where: { bookingId: held.bookingId, toStatus: 'CONFIRMED' },
        }),
      ).toBe(1);
    });
  });

  // ── Refunds ────────────────────────────────────────────────────────────────

  describe('refunds', () => {
    it('refunds in full and then refuses a second full refund', async () => {
      const held = await hold();
      const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });
      await payments.simulateSuccess(order.paymentId);

      const refund = await payments.refund({ paymentId: order.paymentId, adminId: null });
      expect(refund.amountPaise).toBe(order.amountPaise);
      expect(refund.remainingPaise).toBe(0);

      await expect(
        payments.refund({ paymentId: order.paymentId, adminId: null }),
      ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
    });

    it('allows a partial refund and caps the remainder', async () => {
      const held = await hold();
      const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });
      await payments.simulateSuccess(order.paymentId);

      const part = Math.floor(order.amountPaise / 3);
      const first = await payments.refund({ paymentId: order.paymentId, amountPaise: part, adminId: null });
      expect(first.remainingPaise).toBe(order.amountPaise - part);

      const payment = await raw.payment.findUniqueOrThrow({ where: { id: order.paymentId } });
      expect(payment.status).toBe('PARTIALLY_REFUNDED');

      // Two managers each issuing a "full" refund an hour apart is the failure this stops.
      await expect(
        payments.refund({ paymentId: order.paymentId, amountPaise: order.amountPaise, adminId: null }),
      ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
    });

    it('will not refund a payment that was never captured', async () => {
      const held = await hold();
      const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });

      await expect(
        payments.refund({ paymentId: order.paymentId, adminId: null }),
      ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REFUNDABLE' });
    });
  });

  // ── Rewards at checkout ────────────────────────────────────────────────────

  describe('rewards', () => {
    it('applies a reward to the quote and the booking row', async () => {
      // Deliberately smaller than the seeded Head service (₹49) so this asserts the
      // discount itself rather than the clamp — the clamp has its own test below.
      const reward = await grantFlatOff(1_000);

      const quote = await bookings.quote({
        storeId,
        serviceId: headServiceId,
        addonOptionIds: [],
        userId,
        rewardId: reward.id,
      });

      expect(quote.discountPaise).toBe(1_000);
      expect(quote.payablePaise).toBe(quote.basePricePaise + quote.addonsPricePaise - 1_000);
      expect(quote.appliedReward?.label).toBe('₹10 off');

      const held = await hold(reward.id);
      const booking = await raw.booking.findUniqueOrThrow({ where: { id: held.bookingId } });
      expect(booking.discountPaise).toBe(1_000);
      expect(booking.appliedRewardId).toBe(reward.id);
      expect(booking.payablePaise).toBe(booking.basePricePaise + booking.addonsPricePaise - 1_000);
    });

    it('clamps a reward larger than the basket to the subtotal', async () => {
      const reward = await grantFlatOff(5_000);

      const quote = await bookings.quote({
        storeId,
        serviceId: headServiceId,
        addonOptionIds: [],
        userId,
        rewardId: reward.id,
      });

      expect(quote.discountPaise).toBe(quote.basePricePaise + quote.addonsPricePaise);
      expect(quote.payablePaise).toBe(0);
    });

    it('never lets a discount push the payable below zero', async () => {
      const huge = await grantFlatOff(10_000_000);

      const quote = await bookings.quote({
        storeId,
        serviceId: headServiceId,
        addonOptionIds: [],
        userId,
        rewardId: huge.id,
      });

      expect(quote.payablePaise).toBe(0);
      expect(quote.discountPaise).toBe(quote.basePricePaise + quote.addonsPricePaise);
    });

    it('gives one winner when the same reward is raced across two checkouts', async () => {
      const reward = await grantFlatOff(5_000);

      const results = await Promise.allSettled([hold(reward.id, 11), hold(reward.id, 12)]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');

      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);

      const after = await raw.userReward.findUniqueOrThrow({ where: { id: reward.id } });
      expect(after.status).toBe('REDEEMED');
    });

    it('returns the reward to the wallet when the hold is cancelled', async () => {
      const reward = await grantFlatOff(5_000);
      const held = await hold(reward.id);

      expect((await raw.userReward.findUniqueOrThrow({ where: { id: reward.id } })).status).toBe(
        'REDEEMED',
      );

      await lifecycle.transition(held.bookingId, 'CANCELLED', 'CUSTOMER', userId, 'changed mind');

      const restored = await raw.userReward.findUniqueOrThrow({ where: { id: reward.id } });
      expect(restored.status).toBe('ACTIVE');
      expect(restored.redeemedBookingId).toBeNull();
    });

    it('refuses a reward belonging to another customer', async () => {
      const other = await raw.user.upsert({
        where: { phone: '+919000000003' },
        create: { phone: '+919000000003' },
        update: {},
      });
      const theirs = await rewards.grant({
        userId: other.id,
        storeId,
        source: 'MANUAL',
        rewardType: 'FLAT_OFF',
        rewardValue: 5_000,
        validityDays: 30,
      });

      await expect(
        bookings.quote({
          storeId,
          serviceId: headServiceId,
          addonOptionIds: [],
          userId,
          rewardId: theirs.id,
        }),
      ).rejects.toMatchObject({ code: 'REWARD_INVALID' });
    });

    it('refuses an expired reward rather than quietly ignoring it', async () => {
      const reward = await grantFlatOff(5_000);
      await raw.userReward.update({
        where: { id: reward.id },
        data: { validTill: new Date(Date.now() - 86_400_000) },
      });

      await expect(
        bookings.quote({
          storeId,
          serviceId: headServiceId,
          addonOptionIds: [],
          userId,
          rewardId: reward.id,
        }),
      ).rejects.toMatchObject({ code: 'REWARD_INVALID' });
    });

    it('reports why an unusable reward is blocked instead of hiding it', async () => {
      const reward = await rewards.grant({
        userId,
        storeId,
        source: 'MANUAL',
        rewardType: 'FLAT_OFF',
        rewardValue: 5_000,
        minOrderPaise: 10_000_000,
        validityDays: 30,
      });

      const wallet = await rewards.wallet({
        userId,
        storeId,
        basket: { basePricePaise: 19_900, addonsPricePaise: 0 },
        includeUsed: false,
      });

      const row = wallet.find((w) => w.id === reward.id);
      expect(row?.applicable).toBe(false);
      expect(row?.blockedReason).toContain('Needs a booking of');
      expect(row?.discountPaise).toBe(0);
    });
  });

  // ── Scratch cards ──────────────────────────────────────────────────────────

  describe('scratch cards', () => {
    async function campaignWithStock(stockTotal: number | null) {
      return raw.scratchCampaign.create({
        data: {
          storeId,
          name: 'Test campaign',
          trigger: 'ON_CHECKIN',
          isActive: true,
          rewards: {
            create: [
              {
                label: 'Grand prize',
                rewardType: 'FLAT_OFF',
                rewardValue: 50_000,
                weight: 1,
                stockTotal,
                validityDays: 30,
              },
            ],
          },
        },
        include: { rewards: true },
      });
    }

    it('grants a reward and marks the card scratched', async () => {
      const campaign = await campaignWithStock(null);
      const card = await raw.scratchCard.create({
        data: { userId, campaignId: campaign.id, status: 'ISSUED' },
      });

      const result = await scratch.scratchCard(card.id, userId, 0.5);
      expect(result.reward.rewardValue).toBe(50_000);

      const after = await raw.scratchCard.findUniqueOrThrow({ where: { id: card.id } });
      expect(after.status).toBe('SCRATCHED');
      expect(after.scratchRewardId).toBe(campaign.rewards[0]!.id);

      expect(await raw.userReward.count({ where: { userId, source: 'SCRATCH_CARD' } })).toBe(1);
    });

    it('refuses a second scratch of the same card', async () => {
      const campaign = await campaignWithStock(null);
      const card = await raw.scratchCard.create({
        data: { userId, campaignId: campaign.id, status: 'ISSUED' },
      });

      await scratch.scratchCard(card.id, userId, 0.5);

      await expect(scratch.scratchCard(card.id, userId, 0.5)).rejects.toMatchObject({
        code: 'SCRATCH_ALREADY_USED',
      });
      expect(await raw.userReward.count({ where: { userId, source: 'SCRATCH_CARD' } })).toBe(1);
    });

    it('honours a stock cap and hands the card back rather than burning it', async () => {
      const campaign = await campaignWithStock(1);

      const [first, second] = await Promise.all([
        raw.scratchCard.create({ data: { userId, campaignId: campaign.id, status: 'ISSUED' } }),
        raw.scratchCard.create({ data: { userId, campaignId: campaign.id, status: 'ISSUED' } }),
      ]);

      await scratch.scratchCard(first.id, userId, 0.5);

      await expect(scratch.scratchCard(second.id, userId, 0.5)).rejects.toMatchObject({
        code: 'REWARD_INVALID',
      });

      // The customer keeps their card — the store can restock and they lose nothing.
      const returned = await raw.scratchCard.findUniqueOrThrow({ where: { id: second.id } });
      expect(returned.status).toBe('ISSUED');
      expect(returned.scratchedAt).toBeNull();

      const prize = await raw.scratchReward.findUniqueOrThrow({
        where: { id: campaign.rewards[0]!.id },
      });
      expect(prize.stockUsed).toBe(1);
    });

    it('never oversells a capped prize under concurrency', async () => {
      const campaign = await campaignWithStock(3);

      const cards = await Promise.all(
        Array.from({ length: 10 }, () =>
          raw.scratchCard.create({ data: { userId, campaignId: campaign.id, status: 'ISSUED' } }),
        ),
      );

      const results = await Promise.allSettled(
        cards.map((card) => scratch.scratchCard(card.id, userId, 0.5)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);

      const prize = await raw.scratchReward.findUniqueOrThrow({
        where: { id: campaign.rewards[0]!.id },
      });
      expect(prize.stockUsed).toBe(3);
    });
  });

  // ── Product stock ──────────────────────────────────────────────────────────

  describe('product stock', () => {
    async function seedProduct(stockQty: number) {
      return raw.product.create({
        data: {
          storeId,
          name: 'Test Balm',
          slug: `test-balm-${Date.now()}`,
          pricePaise: 29_900,
          stockQty,
          isActive: true,
        },
      });
    }

    it('decrements stock when an order is placed', async () => {
      const product = await seedProduct(5);

      const order = await products.createOrder({
        storeId,
        userId,
        input: { items: [{ productId: product.id, qty: 2 }] },
      });

      expect(order.totalPaise).toBe(59_800);
      expect((await raw.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(3);
    });

    it('refuses to oversell', async () => {
      const product = await seedProduct(1);

      await expect(
        products.createOrder({
          storeId,
          userId,
          input: { items: [{ productId: product.id, qty: 2 }] },
        }),
      ).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });

      expect((await raw.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(1);
    });

    it('merges duplicate lines so they cannot each pass their own stock check', async () => {
      const product = await seedProduct(3);

      await expect(
        products.createOrder({
          storeId,
          userId,
          input: {
            items: [
              { productId: product.id, qty: 2 },
              { productId: product.id, qty: 2 },
            ],
          },
        }),
      ).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });

      expect((await raw.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(3);
    });

    it('gives exactly one winner when the last unit is contested', async () => {
      const product = await seedProduct(1);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          products.createOrder({
            storeId,
            userId,
            input: { items: [{ productId: product.id, qty: 1 }] },
          }),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await raw.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(0);
    });

    it('returns stock to the shelf when an order is cancelled', async () => {
      const product = await seedProduct(4);

      const order = await products.createOrder({
        storeId,
        userId,
        input: { items: [{ productId: product.id, qty: 3 }] },
      });
      expect((await raw.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(1);

      await products.setOrderStatus({ storeId, orderId: order.id, status: 'CANCELLED' });

      expect((await raw.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(4);
    });
  });

  it('runs in simulated payment mode for these tests', () => {
    // Guards the suite itself: if credentials ever land in `.env`, these tests would start
    // making live calls to Razorpay, and the failure would look like a network flake.
    expect(gateway.simulated).toBe(true);
  });
});
