import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Client requests of 06/11/2026, end to end over HTTP:
 *
 *   "video call pe coupon code, cashback bataa dena" — there was no coupon code to explain,
 *   so codes the shop creates and customers type at checkout;
 *
 *   "booking hone ke baad mujhe notifications nhi aa raha" — a booking paid at the counter
 *   told nobody: no confirmation for the customer and nothing at all for the shop;
 *
 * and a bug found while answering the first: the "Checked in" button on a booking in the
 * admin panel gave the customer no streak visit, scratch card or cashback.
 */

const raw = new PrismaClient();

interface Customer {
  readonly id: string;
  readonly auth: string;
}

describe('client requests of 06/11/2026', () => {
  let app: INestApplication;
  let issue: (claims: { sub: string; aud: 'customer' | 'admin'; role?: string; storeId?: string }) => string;
  let storeId: string;
  let timezone: string;
  let headId: string;
  let adminAuth: string;
  let date: string;
  let sequence = 0;

  const http = () => request(app.getHttpServer());

  async function freshCustomer(): Promise<Customer> {
    sequence += 1;
    const uid = `test-2026-11-06-${Date.now()}-${sequence}`;
    const phone = `+9193${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const user = await raw.user.create({
      data: { firebaseUid: uid, name: `Coupon customer ${sequence}`, phone, consentAt: new Date() },
    });
    return { id: user.id, auth: `Bearer ${issue({ sub: user.id, aud: 'customer' })}` };
  }

  const at = (hour: number, minute = 0): string =>
    DateTime.fromISO(date, { zone: timezone }).set({ hour, minute }).toISO()!;

  const createCode = (body: Record<string, unknown>) =>
    http().post('/api/v1/admin/rewards/coupons').set('Authorization', adminAuth).send(body);

  const quote = (customer: Customer, extra: Record<string, unknown>) =>
    http()
      .post('/api/v1/bookings/quote')
      .set('Authorization', customer.auth)
      .send({ serviceId: headId, addonOptionIds: [], ...extra });

  const book = (customer: Customer, startsAt: string, extra: Record<string, unknown> = {}) =>
    http()
      .post('/api/v1/bookings/hold')
      .set('Authorization', customer.auth)
      .send({ serviceId: headId, startsAt, addonOptionIds: [], paymentMethod: 'COUNTER', ...extra });

  const markPaid = (bookingId: string) =>
    http()
      .post(`/api/v1/admin/bookings/${bookingId}/mark-paid`)
      .set('Authorization', adminAuth)
      .send({ method: 'CASH' });

  /**
   * Messages go out after the response, so a test waits for its own row to be sent rather
   * than racing it. Rows from earlier runs stay in the table, hence `mine`.
   */
  async function waitForLog(
    where: { template: string; userId?: string | null },
    mine: (payload: Record<string, unknown>) => boolean = () => true,
  ) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const rows = (await raw.notificationLog.findMany({ where, orderBy: { createdAt: 'desc' } }))
        .filter((row) => mine((row.payload ?? {}) as Record<string, unknown>));
      if (rows.length > 0 && rows.every((row) => row.status !== 'QUEUED')) return rows;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return [];
  }

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module.js');
    const { ProblemJsonFilter } = await import('../../src/common/problem-json.filter.js');
    const { TokenService } = await import('../../src/auth/token.service.js');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ProblemJsonFilter());
    await app.init();

    const tokens = app.get(TokenService);
    issue = (claims) => tokens.issueAccess(claims);

    const store = await raw.store.findFirstOrThrow({ where: { slug: 'reset-satellite' } });
    storeId = store.id;
    timezone = store.timezone;
    headId = (await raw.service.findFirstOrThrow({ where: { storeId, slug: 'head' } })).id;

    const admin = await raw.adminUser.upsert({
      where: { email: 'coupon-owner@test.reset.app' },
      create: {
        email: 'coupon-owner@test.reset.app',
        passwordHash: 'not-a-password-hash',
        name: 'Coupon Owner',
        role: 'OWNER',
        storeId,
      },
      update: { isActive: true },
    });
    adminAuth = `Bearer ${issue({ sub: admin.id, aud: 'admin', role: 'OWNER', storeId })}`;

    // Tomorrow, or the day after if tomorrow is the seed store's closed Monday.
    let cursor = DateTime.now().setZone(timezone).plus({ days: 1 }).startOf('day');
    while (cursor.weekday === 1) cursor = cursor.plus({ days: 1 });
    date = cursor.toISODate()!;
  });

  beforeEach(async () => {
    await raw.refund.deleteMany({ where: { payment: { storeId } } });
    await raw.payment.deleteMany({ where: { storeId } });
    await raw.booking.deleteMany({ where: { storeId } });
    await raw.coupon.deleteMany({ where: { storeId } });
  });

  afterEach(() => {
    delete process.env.STORE_ALERT_EMAIL;
  });

  afterAll(async () => {
    await raw.refund.deleteMany({ where: { payment: { storeId } } });
    await raw.payment.deleteMany({ where: { storeId } });
    await raw.booking.deleteMany({ where: { storeId } });
    await raw.coupon.deleteMany({ where: { storeId } });
    await raw.$disconnect();
    await app.close();
  });

  // ── Coupon codes ──────────────────────────────────────────────────────────

  describe('coupon codes', () => {
    it('takes a code off the price however the customer types it', async () => {
      await createCode({ code: 'RESET20', rewardType: 'PERCENT_OFF', rewardValue: 20 }).expect(201);
      const customer = await freshCustomer();

      const priced = await quote(customer, { couponCode: ' reset 20 ' }).expect(201);

      expect(priced.body.appliedCoupon).toMatchObject({ code: 'RESET20', label: '20% off' });
      expect(priced.body.discountPaise).toBe(Math.floor(priced.body.basePricePaise * 0.2));
      expect(priced.body.payablePaise).toBe(priced.body.basePricePaise - priced.body.discountPaise);
    });

    it('says plainly when a code does not exist', async () => {
      const customer = await freshCustomer();
      const res = await quote(customer, { couponCode: 'NOSUCHCODE' }).expect(404);
      expect(res.body.code).toBe('COUPON_INVALID');
      expect(res.body.detail).toContain('We do not recognise "NOSUCHCODE"');
    });

    it('refuses a duplicate code when the shop creates one', async () => {
      await createCode({ code: 'DIWALI', rewardType: 'FLAT_OFF', rewardValue: 5000 }).expect(201);
      const again = await createCode({ code: 'diwali', rewardType: 'FLAT_OFF', rewardValue: 2000 }).expect(422);
      expect(again.body.detail).toContain('There is already a code called DIWALI');
    });

    it('allows one discount per booking, a code or a reward', async () => {
      await createCode({ code: 'ONEOFF', rewardType: 'FLAT_OFF', rewardValue: 2000 }).expect(201);
      const customer = await freshCustomer();
      const reward = await raw.userReward.create({
        data: {
          userId: customer.id,
          storeId,
          source: 'MANUAL',
          rewardType: 'FLAT_OFF',
          rewardValue: 1000,
          validTill: new Date(Date.now() + 86_400_000),
        },
      });

      const res = await quote(customer, { couponCode: 'ONEOFF', rewardId: reward.id }).expect(422);
      expect(res.body.detail).toBe('Use a reward or a code on this booking, not both.');
    });

    it('books with a code and counts it against that customer', async () => {
      await createCode({ code: 'WELCOME', rewardType: 'FLAT_OFF', rewardValue: 2000 }).expect(201);
      const first = await freshCustomer();
      const second = await freshCustomer();

      const booked = await book(first, at(17), { couponCode: 'WELCOME' }).expect(201);
      const row = await raw.booking.findUniqueOrThrow({
        where: { id: booked.body.bookingId },
        include: { appliedCoupon: true },
      });
      expect(row.appliedCoupon?.code).toBe('WELCOME');
      expect(row.discountPaise).toBe(2000);
      expect(row.payablePaise).toBe(row.basePricePaise - 2000);

      const again = await quote(first, { couponCode: 'WELCOME' }).expect(422);
      expect(again.body.detail).toBe('You have already used this code.');

      // Somebody else still can.
      await quote(second, { couponCode: 'WELCOME' }).expect(201);
    });

    it('gives a use back when the booking is cancelled', async () => {
      await createCode({ code: 'LASTONE', rewardType: 'FLAT_OFF', rewardValue: 1000, maxUses: 1 }).expect(201);
      const first = await freshCustomer();
      const second = await freshCustomer();

      const booked = await book(first, at(17, 30), { couponCode: 'LASTONE' }).expect(201);
      const full = await quote(second, { couponCode: 'LASTONE' }).expect(422);
      expect(full.body.detail).toBe('This code has been used up.');

      await http()
        .post(`/api/v1/bookings/${booked.body.bookingId}/cancel`)
        .set('Authorization', first.auth)
        .send({})
        .expect(201);

      await quote(second, { couponCode: 'LASTONE' }).expect(201);
    });

    it('pays cashback from a code at check-in, as a voucher for the next visit (below the ₹49 price, which caps it)', async () => {
      await createCode({ code: 'CASH20', rewardType: 'CASHBACK', rewardValue: 2000 }).expect(201);
      const customer = await freshCustomer();

      const priced = await quote(customer, { couponCode: 'CASH20' }).expect(201);
      expect(priced.body.discountPaise).toBe(0);
      expect(priced.body.appliedCoupon.postVisitCreditPaise).toBe(2000);

      const booked = await book(customer, at(18), { couponCode: 'CASH20' }).expect(201);
      await markPaid(booked.body.bookingId).expect(201);
      await http()
        .post('/api/v1/admin/checkins/manual')
        .set('Authorization', adminAuth)
        .send({ publicId: booked.body.publicId })
        .expect(201);

      const voucher = await raw.userReward.findFirst({
        where: { userId: customer.id, source: 'PROMO', sourceId: booked.body.bookingId },
      });
      expect(voucher).toMatchObject({ rewardType: 'FLAT_OFF', rewardValue: 2000, status: 'ACTIVE' });
    });

    it('lists codes for the shop with how often each was used', async () => {
      await createCode({ code: 'POSTER', rewardType: 'FLAT_OFF', rewardValue: 1500, note: 'Window poster' }).expect(201);
      const customer = await freshCustomer();
      await book(customer, at(18, 30), { couponCode: 'POSTER' }).expect(201);

      const list = await http().get('/api/v1/admin/rewards/coupons').set('Authorization', adminAuth).expect(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({ code: 'POSTER', label: '₹15 off', note: 'Window poster', uses: 1 }),
      ]);
    });

    it('stops accepting a code the shop turns off', async () => {
      const created = await createCode({ code: 'SUMMER', rewardType: 'FLAT_OFF', rewardValue: 1000 }).expect(201);
      await http()
        .put(`/api/v1/admin/rewards/coupons/${created.body.id}`)
        .set('Authorization', adminAuth)
        .send({ code: 'SUMMER', rewardType: 'FLAT_OFF', rewardValue: 1000, isActive: false })
        .expect(200);

      const customer = await freshCustomer();
      const res = await quote(customer, { couponCode: 'SUMMER' }).expect(422);
      expect(res.body.detail).toBe('This code is no longer active.');
    });
  });

  // ── Notifications ─────────────────────────────────────────────────────────

  describe('after a booking', () => {
    it('confirms a counter booking to the customer', async () => {
      const customer = await freshCustomer();
      await book(customer, at(19)).expect(201);

      const rows = await waitForLog({ template: 'booking_confirmed', userId: customer.id });
      expect(rows.length).toBeGreaterThan(0);
    });

    it('emails the shop when a customer books, and not for a walk-in', async () => {
      process.env.STORE_ALERT_EMAIL = 'owner@test.reset.app';
      const customer = await freshCustomer();
      const booked = await book(customer, at(19, 30)).expect(201);

      const forThis = await waitForLog(
        { template: 'store_new_booking', userId: null },
        (payload) => payload.publicId === booked.body.publicId,
      );
      expect(forThis).toHaveLength(1);
      expect(forThis[0]).toMatchObject({ channel: 'EMAIL', status: 'SENT' });
      expect((forThis[0]!.payload as { to: string }).to).toBe('owner@test.reset.app');

      const walkIn = await http()
        .post('/api/v1/admin/bookings/walk-in')
        .set('Authorization', adminAuth)
        .send({ serviceId: headId, startsAt: at(20), addonOptionIds: [], customerName: 'Walk-in test' })
        .expect(201);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const all = await raw.notificationLog.findMany({ where: { template: 'store_new_booking' } });
      expect(all.some((r) => (r.payload as { publicId?: string }).publicId === walkIn.body.publicId)).toBe(false);
    });

    it('gives the admin panel the bookings confirmed since it last looked', async () => {
      const start = await http()
        .get('/api/v1/admin/bookings/confirmed-since')
        .set('Authorization', adminAuth)
        .expect(200);
      expect(start.body.bookings).toEqual([]);

      const customer = await freshCustomer();
      const booked = await book(customer, at(20, 30)).expect(201);

      const next = await http()
        .get('/api/v1/admin/bookings/confirmed-since')
        .query({ after: start.body.now })
        .set('Authorization', adminAuth)
        .expect(200);
      expect(next.body.bookings).toEqual([
        expect.objectContaining({ publicId: booked.body.publicId, serviceName: expect.any(String) }),
      ]);

      // Asked again from the new cursor, the same booking is not announced twice.
      const after = await http()
        .get('/api/v1/admin/bookings/confirmed-since')
        .query({ after: next.body.now })
        .set('Authorization', adminAuth)
        .expect(200);
      expect(after.body.bookings).toEqual([]);
    });
  });

  // ── Check-in from the booking drawer ──────────────────────────────────────

  it('counts a visit checked in from the booking drawer, as the Check in page does', async () => {
    const customer = await freshCustomer();
    const booked = await book(customer, at(17, 45)).expect(201);
    await markPaid(booked.body.bookingId).expect(201);

    await http()
      .post(`/api/v1/admin/bookings/${booked.body.bookingId}/status`)
      .set('Authorization', adminAuth)
      .send({ status: 'CHECKED_IN' })
      .expect(201);

    const streak = await raw.userStreak.findUnique({ where: { userId: customer.id } });
    expect(streak?.totalVisits).toBe(1);
  });
});
