import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AvailabilityService } from '../../src/availability/availability.service.js';
import { ScheduleResolverService } from '../../src/availability/schedule-resolver.service.js';
import { BookingLifecycleService } from '../../src/booking/booking-lifecycle.service.js';
import { BookingService } from '../../src/booking/booking.service.js';
import { CheckinService } from '../../src/checkin/checkin.service.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { PrivacyJobs } from '../../src/jobs/privacy.jobs.js';
import {
  EmailProvider,
  SmsProvider,
  WhatsAppProvider,
} from '../../src/notifications/channel.providers.js';
import { FcmProvider } from '../../src/notifications/fcm.provider.js';
import { NotificationService } from '../../src/notifications/notification.service.js';
import { PaymentService } from '../../src/payments/payment.service.js';
import { RazorpayClient } from '../../src/payments/razorpay.client.js';
import { RewardsService } from '../../src/rewards/rewards.service.js';
import { ScratchService } from '../../src/rewards/scratch.service.js';
import { StreakService } from '../../src/rewards/streak.service.js';

/**
 * The hardening pass: reschedule, blocked customers, cashback payout, and data retention.
 *
 * Each of these is a rule that only matters in a case nobody exercises by hand — a customer
 * blocked mid-session, a reschedule that collides with itself, a cashback credited twice, an
 * account deleted a month ago. All four are cheap to get wrong and expensive to notice.
 */
describe('hardening', () => {
  let moduleRef: TestingModule;
  let bookings: BookingService;
  let payments: PaymentService;
  let rewards: RewardsService;
  let checkin: CheckinService;
  let privacy: PrivacyJobs;

  const raw = new PrismaClient();
  let storeId: string;
  let timezone: string;
  let headServiceId: string;
  let userId: string;
  let adminId: string;
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
        PrivacyJobs,
      ],
    }).compile();

    await moduleRef.get(PrismaService).$connect();
    bookings = moduleRef.get(BookingService);
    payments = moduleRef.get(PaymentService);
    rewards = moduleRef.get(RewardsService);
    checkin = moduleRef.get(CheckinService);
    privacy = moduleRef.get(PrivacyJobs);

    const store = await raw.store.findFirstOrThrow({ where: { slug: 'reset-satellite' } });
    storeId = store.id;
    timezone = store.timezone;

    headServiceId = (await raw.service.findFirstOrThrow({ where: { storeId, slug: 'head' } })).id;

    const user = await raw.user.upsert({
      where: { phone: '+919100000001' },
      create: { phone: '+919100000001', name: 'Hardening Test' },
      update: { isBlocked: false, blockedReason: null, deletedAt: null },
    });
    userId = user.id;

    adminId = (await raw.adminUser.findFirstOrThrow({ select: { id: true } })).id;

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
    await raw.notificationLog.deleteMany({});
    await raw.booking.deleteMany({});
    await raw.userReward.deleteMany({});
    await raw.userStreak.deleteMany({});
    await raw.streakRule.deleteMany({});
    await raw.deviceToken.deleteMany({});
    await raw.idempotencyKey.deleteMany({});
    // The phone is restored too, not just the flags: the purge tests rewrite it to a
    // `deleted-` tombstone, and a later test starting from that state would be asserting
    // against the previous test's leftovers rather than a clean fixture.
    await raw.user.update({
      where: { id: userId },
      data: {
        phone: '+919100000001',
        name: 'Hardening Test',
        isBlocked: false,
        blockedReason: null,
        deletedAt: null,
      },
    });
  });

  function at(hour: number, minute = 0): string {
    return DateTime.fromISO(date, { zone: timezone }).set({ hour, minute }).toISO()!;
  }

  async function confirmedBooking(hour = 14) {
    const held = await bookings.hold({
      storeId,
      serviceId: headServiceId,
      addonOptionIds: [],
      startsAt: at(hour),
      userId,
      source: 'WEB',
    });

    const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });
    await payments.simulateSuccess(order.paymentId);

    return held;
  }

  // ── Reschedule ─────────────────────────────────────────────────────────────

  describe('reschedule', () => {
    it('moves a confirmed booking without re-charging it', async () => {
      const held = await confirmedBooking(14);
      const before = await raw.booking.findUniqueOrThrow({ where: { id: held.bookingId } });

      const moved = await bookings.reschedule({
        bookingId: held.bookingId,
        userId,
        startsAt: at(16),
        actorType: 'CUSTOMER',
        actorId: userId,
      });

      expect(moved.payablePaise).toBe(before.payablePaise);

      const after = await raw.booking.findUniqueOrThrow({
        where: { id: held.bookingId },
        include: { checkinToken: true },
      });

      expect(after.status).toBe('CONFIRMED');
      expect(after.startsAt.getTime()).not.toBe(before.startsAt.getTime());
      // The QR must survive. Reissuing it would invalidate the code already on the
      // customer's phone, which is the thing they will actually show at the counter.
      expect(after.checkinToken?.token).toBe(
        (await raw.checkinToken.findUnique({ where: { bookingId: held.bookingId } }))?.token,
      );
      expect(after.checkinToken).not.toBeNull();
    });

    it('keeps the payment attached to the same booking', async () => {
      const held = await confirmedBooking(14);

      await bookings.reschedule({
        bookingId: held.bookingId,
        userId,
        startsAt: at(16),
        actorType: 'CUSTOMER',
        actorId: userId,
      });

      const payment = await raw.payment.findFirstOrThrow({
        where: { bookingId: held.bookingId },
      });
      expect(payment.status).toBe('CAPTURED');
      expect(await raw.payment.count({ where: { bookingId: held.bookingId } })).toBe(1);
      expect(await raw.refund.count()).toBe(0);
    });

    it('records the move in the status history', async () => {
      const held = await confirmedBooking(14);

      await bookings.reschedule({
        bookingId: held.bookingId,
        userId,
        startsAt: at(16),
        actorType: 'CUSTOMER',
        actorId: userId,
      });

      const history = await raw.bookingStatusHistory.findFirst({
        where: { bookingId: held.bookingId, reason: { startsWith: 'Rescheduled from' } },
      });
      expect(history).not.toBeNull();
    });

    it('can move a booking a few minutes later without colliding with itself', async () => {
      // The regression this guards: the booking being moved still occupies its old station,
      // so without excluding it the engine sees its own trailing buffer as someone else's.
      const held = await confirmedBooking(14);

      const moved = await bookings.reschedule({
        bookingId: held.bookingId,
        userId,
        startsAt: at(14, 5),
        actorType: 'CUSTOMER',
        actorId: userId,
      });

      expect(DateTime.fromISO(moved.startsAt).minute).toBe(5);
    });

    it('refuses to move a booking onto a fully occupied time', async () => {
      const stationCount = await raw.station.count({ where: { storeId, isActive: true } });
      const held = await confirmedBooking(14);

      // Fill every station at 16:00.
      for (let i = 0; i < stationCount; i += 1) {
        await bookings.hold({
          storeId,
          serviceId: headServiceId,
          addonOptionIds: [],
          startsAt: at(16),
          userId: null,
          source: 'ADMIN_WALKIN',
        });
      }

      await expect(
        bookings.reschedule({
          bookingId: held.bookingId,
          userId,
          startsAt: at(16),
          actorType: 'CUSTOMER',
          actorId: userId,
        }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/SLOT_(TAKEN|UNAVAILABLE)/) });

      // And the original booking is untouched.
      const after = await raw.booking.findUniqueOrThrow({ where: { id: held.bookingId } });
      expect(after.startsAt.getTime()).toBe(DateTime.fromISO(at(14)).toMillis());
    });

    it('refuses a customer reschedule inside the cancellation window', async () => {
      const held = await confirmedBooking(14);

      // Drag the booking to five minutes from now, inside any sane cancellation window.
      await raw.booking.update({
        where: { id: held.bookingId },
        data: { startsAt: new Date(Date.now() + 5 * 60_000) },
      });

      await expect(
        bookings.reschedule({
          bookingId: held.bookingId,
          userId,
          startsAt: at(18),
          actorType: 'CUSTOMER',
          actorId: userId,
        }),
      ).rejects.toMatchObject({ code: 'BOOKING_NOT_CANCELLABLE' });
    });

    it('lets an admin move a booking inside that window', async () => {
      // Staff taking a phone call are exactly who the policy should not obstruct.
      const held = await confirmedBooking(14);

      await raw.booking.update({
        where: { id: held.bookingId },
        data: { startsAt: new Date(Date.now() + 5 * 60_000) },
      });

      const moved = await bookings.reschedule({
        bookingId: held.bookingId,
        userId: null,
        startsAt: at(18),
        actorType: 'ADMIN',
        actorId: adminId,
      });

      expect(DateTime.fromISO(moved.startsAt).hour).toBe(18);
    });

    it('will not reschedule an unpaid hold', async () => {
      const held = await bookings.hold({
        storeId,
        serviceId: headServiceId,
        addonOptionIds: [],
        startsAt: at(14),
        userId,
        source: 'WEB',
      });

      await expect(
        bookings.reschedule({
          bookingId: held.bookingId,
          userId,
          startsAt: at(16),
          actorType: 'CUSTOMER',
          actorId: userId,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses another customer’s booking', async () => {
      const held = await confirmedBooking(14);
      const other = await raw.user.upsert({
        where: { phone: '+919100000002' },
        create: { phone: '+919100000002' },
        update: {},
      });

      await expect(
        bookings.reschedule({
          bookingId: held.bookingId,
          userId: other.id,
          startsAt: at(16),
          actorType: 'CUSTOMER',
          actorId: other.id,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ── Blocked customers ──────────────────────────────────────────────────────

  describe('blocked customers', () => {
    it('refuses a hold from a blocked account', async () => {
      await raw.user.update({
        where: { id: userId },
        data: { isBlocked: true, blockedReason: 'Repeated no-shows' },
      });

      await expect(
        bookings.hold({
          storeId,
          serviceId: headServiceId,
          addonOptionIds: [],
          startsAt: at(14),
          userId,
          source: 'WEB',
        }),
      ).rejects.toMatchObject({ code: 'CUSTOMER_BLOCKED', detail: 'Repeated no-shows' });
    });

    it('still allows an anonymous walk-in taken at the counter', async () => {
      await raw.user.update({ where: { id: userId }, data: { isBlocked: true } });

      const held = await bookings.hold({
        storeId,
        serviceId: headServiceId,
        addonOptionIds: [],
        startsAt: at(15),
        userId: null,
        source: 'ADMIN_WALKIN',
      });

      expect(held.status).toBe('HELD');
    });
  });

  // ── Cashback ───────────────────────────────────────────────────────────────

  describe('cashback', () => {
    async function grantCashback(paise: number) {
      return rewards.grant({
        userId,
        storeId,
        source: 'MANUAL',
        rewardType: 'CASHBACK',
        rewardValue: paise,
        validityDays: 30,
      });
    }

    it('is selectable at checkout but discounts nothing', async () => {
      const reward = await grantCashback(1_000);

      const quote = await bookings.quote({
        storeId,
        serviceId: headServiceId,
        addonOptionIds: [],
        userId,
        rewardId: reward.id,
      });

      expect(quote.discountPaise).toBe(0);
      expect(quote.payablePaise).toBe(quote.basePricePaise + quote.addonsPricePaise);
    });

    it('reports the post-visit credit separately in the wallet', async () => {
      const reward = await grantCashback(1_000);

      const wallet = await rewards.wallet({
        userId,
        storeId,
        basket: { basePricePaise: 4_900, addonsPricePaise: 0 },
        includeUsed: false,
      });

      const row = wallet.find((w) => w.id === reward.id);
      expect(row?.applicable).toBe(true);
      expect(row?.discountPaise).toBe(0);
      expect(row?.postVisitCreditPaise).toBe(1_000);
    });

    it('credits the wallet on check-in, not on payment', async () => {
      const reward = await grantCashback(1_000);

      const held = await bookings.hold({
        storeId,
        serviceId: headServiceId,
        addonOptionIds: [],
        startsAt: at(14),
        userId,
        rewardId: reward.id,
        source: 'WEB',
      });

      const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });
      await payments.simulateSuccess(order.paymentId);

      // Paid, but not yet visited — nothing credited.
      expect(await raw.userReward.count({ where: { userId, source: 'PROMO' } })).toBe(0);

      await checkin.redeemPublicId(held.publicId, adminId);

      const credited = await raw.userReward.findFirstOrThrow({
        where: { userId, source: 'PROMO' },
      });
      expect(credited.rewardType).toBe('FLAT_OFF');
      expect(credited.rewardValue).toBe(1_000);
      expect(credited.sourceId).toBe(held.bookingId);
    });

    it('does not credit twice if the payout runs again', async () => {
      const reward = await grantCashback(1_000);

      const held = await bookings.hold({
        storeId,
        serviceId: headServiceId,
        addonOptionIds: [],
        startsAt: at(14),
        userId,
        rewardId: reward.id,
        source: 'WEB',
      });
      const order = await payments.createOrder({ storeId, userId, bookingId: held.bookingId });
      await payments.simulateSuccess(order.paymentId);
      await checkin.redeemPublicId(held.publicId, adminId);

      const again = await rewards.creditCashback(held.bookingId);

      expect(again.credited).toBe(false);
      expect(await raw.userReward.count({ where: { userId, source: 'PROMO' } })).toBe(1);
    });

    it('credits nothing for a booking with no cashback reward', async () => {
      const held = await confirmedBooking(14);
      expect((await rewards.creditCashback(held.bookingId)).credited).toBe(false);
    });
  });

  // ── Data retention ─────────────────────────────────────────────────────────

  describe('account purge', () => {
    it('anonymises a deleted account but keeps its bookings', async () => {
      const held = await confirmedBooking(14);

      await raw.deviceToken.create({
        data: { userId, token: `tok-${Date.now()}`, platform: 'ANDROID' },
      });
      await raw.booking.update({
        where: { id: held.bookingId },
        data: { notes: 'Prefers Station 2, call on 98765 43210' },
      });

      // Deleted 40 days ago, past the default 30-day retention.
      await raw.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(Date.now() - 40 * 86_400_000) },
      });

      await privacy.purgeDeletedAccounts();

      const purged = await raw.user.findUniqueOrThrow({ where: { id: userId } });
      expect(purged.phone.startsWith('deleted-')).toBe(true);
      expect(purged.name).toBeNull();
      expect(purged.email).toBeNull();
      expect(purged.consentAt).toBeNull();

      expect(await raw.deviceToken.count({ where: { userId } })).toBe(0);

      // The booking survives — it is a financial record, and the revenue report depends on it.
      const booking = await raw.booking.findUniqueOrThrow({ where: { id: held.bookingId } });
      expect(booking.payablePaise).toBeGreaterThan(0);
      expect(booking.userId).toBe(userId);
      // …but the free-text note, which routinely contains a name or a number, does not.
      expect(booking.notes).toBeNull();
    });

    it('leaves an account deleted recently alone', async () => {
      await raw.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(Date.now() - 3 * 86_400_000) },
      });

      await privacy.purgeDeletedAccounts();

      const still = await raw.user.findUniqueOrThrow({ where: { id: userId } });
      expect(still.phone).toBe('+919100000001');
    });

    it('is idempotent — a second run does not touch an already-purged account', async () => {
      await raw.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(Date.now() - 40 * 86_400_000) },
      });

      await privacy.purgeDeletedAccounts();
      const first = await raw.user.findUniqueOrThrow({ where: { id: userId } });

      await privacy.purgeDeletedAccounts();
      const second = await raw.user.findUniqueOrThrow({ where: { id: userId } });

      expect(second.phone).toBe(first.phone);
    });

    it('drops expired idempotency keys', async () => {
      await raw.idempotencyKey.create({
        data: {
          key: `expired-${Date.now()}`,
          storeId,
          endpoint: 'POST /test',
          requestHash: 'x',
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      await privacy.purgeIdempotencyKeys();

      expect(await raw.idempotencyKey.count()).toBe(0);
    });
  });

  // Restore the fixture user for any suite that runs after this one.
  afterAll(async () => {
    await raw.user
      .update({
        where: { id: userId },
        data: { phone: '+919100000001', deletedAt: null, isBlocked: false },
      })
      .catch(() => undefined);
  });
});
