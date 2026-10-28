import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Pay online or at the counter — client request of 28/10/2026, end to end over HTTP.
 *
 * Runs with online payment switched on (the suite default, see setup-env.ts), because that
 * is how production will run: both ways to pay offered side by side. The gateway is the
 * simulated one, so orders, captures and refunds complete without a network.
 *
 * Each case is a path that was built for a store that could only take money at the counter
 * and would have gone wrong the day online payment arrived.
 */

const raw = new PrismaClient();

interface Customer {
  readonly id: string;
  readonly auth: string;
}

describe('pay online or at the counter', () => {
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
    const uid = `test-payment-choice-${Date.now()}-${sequence}`;
    const phone = `+9192${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const user = await raw.user.create({
      data: { firebaseUid: uid, name: `Payer ${sequence}`, phone, consentAt: new Date() },
    });
    return { id: user.id, auth: `Bearer ${issue({ sub: user.id, aud: 'customer' })}` };
  }

  const at = (hour: number, minute = 0): string =>
    DateTime.fromISO(date, { zone: timezone }).set({ hour, minute }).toISO()!;

  const hold = (customer: Customer, startsAt: string, extra: Record<string, unknown> = {}) =>
    http()
      .post('/api/v1/bookings/hold')
      .set('Authorization', customer.auth)
      .send({ serviceId: headId, startsAt, addonOptionIds: [], rewardId: null, ...extra });

  const payOrder = (customer: Customer, bookingId: string) =>
    http()
      .post('/api/v1/payments/order')
      .set('Authorization', customer.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ bookingId });

  const settle = (customer: Customer, paymentId: string) =>
    http().post(`/api/v1/payments/${paymentId}/simulate-success`).set('Authorization', customer.auth);

  const detail = async (customer: Customer, id: string) =>
    (await http().get(`/api/v1/bookings/${id}`).set('Authorization', customer.auth).expect(200))
      .body;

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
      where: { email: 'payment-choice-admin@test.reset.app' },
      create: {
        email: 'payment-choice-admin@test.reset.app',
        passwordHash: 'not-a-password-hash',
        name: 'Till Tester',
        role: 'OWNER',
        storeId,
      },
      update: { isActive: true },
    });
    adminAuth = `Bearer ${issue({ sub: admin.id, aud: 'admin', role: 'OWNER', storeId })}`;

    // Tomorrow, or the day after if tomorrow is the seed store's closed Monday — always far
    // enough ahead that cancelling is still allowed.
    let cursor = DateTime.now().setZone(timezone).plus({ days: 1 }).startOf('day');
    while (cursor.weekday === 1) cursor = cursor.plus({ days: 1 });
    date = cursor.toISODate()!;
  });

  beforeEach(async () => {
    await raw.refund.deleteMany({ where: { payment: { storeId } } });
    await raw.payment.deleteMany({ where: { storeId } });
    await raw.productOrder.deleteMany({ where: { storeId, publicId: { startsWith: 'ORD-T' } } });
    await raw.booking.deleteMany({ where: { storeId } });
  });

  afterAll(async () => {
    await raw.refund.deleteMany({ where: { payment: { storeId } } });
    await raw.payment.deleteMany({ where: { storeId } });
    await raw.productOrder.deleteMany({ where: { storeId, publicId: { startsWith: 'ORD-T' } } });
    await raw.$disconnect();
    await app.close();
  });

  it('confirms a counter booking at once, with nothing to charge', async () => {
    const customer = await freshCustomer();
    const res = await hold(customer, at(17), { paymentMethod: 'COUNTER' }).expect(201);
    expect(res.body).toMatchObject({
      status: 'CONFIRMED',
      paymentRequired: false,
      paymentMethod: 'COUNTER',
    });
    expect((await detail(customer, res.body.bookingId)).isPaid).toBe(false);
  });

  it('treats a booking that names no method as the counter — what an older app sends', async () => {
    const customer = await freshCustomer();
    const res = await hold(customer, at(17, 30)).expect(201);
    expect(res.body).toMatchObject({ status: 'CONFIRMED', paymentRequired: false });
  });

  it('holds an online booking until the gateway says it is paid', async () => {
    const customer = await freshCustomer();
    const res = await hold(customer, at(18), { paymentMethod: 'ONLINE' }).expect(201);
    expect(res.body).toMatchObject({ paymentRequired: true, paymentMethod: 'ONLINE' });
    expect((await detail(customer, res.body.bookingId)).status).toBe('HELD');

    const order = await payOrder(customer, res.body.bookingId).expect(201);
    await settle(customer, order.body.paymentId).expect(201);

    const after = await detail(customer, res.body.bookingId);
    expect(after.status).toBe('CONFIRMED');
    expect(after.isPaid).toBe(true);
  });

  it('turns a failed online attempt into a counter booking without losing the slot', async () => {
    const customer = await freshCustomer();
    const res = await hold(customer, at(18, 30), { paymentMethod: 'ONLINE' }).expect(201);
    const id: string = res.body.bookingId;

    const switched = await http()
      .post(`/api/v1/bookings/${id}/pay-at-counter`)
      .set('Authorization', customer.auth)
      .expect(201);
    expect(switched.body).toMatchObject({ status: 'CONFIRMED', paymentRequired: false });

    // Pressed twice on a slow connection: still booked, not an error.
    await http()
      .post(`/api/v1/bookings/${id}/pay-at-counter`)
      .set('Authorization', customer.auth)
      .expect(201);

    expect(await detail(customer, id)).toMatchObject({ status: 'CONFIRMED', isPaid: false });
  });

  it("will not switch somebody else's booking", async () => {
    const owner = await freshCustomer();
    const stranger = await freshCustomer();
    const res = await hold(owner, at(19), { paymentMethod: 'ONLINE' }).expect(201);
    await http()
      .post(`/api/v1/bookings/${res.body.bookingId}/pay-at-counter`)
      .set('Authorization', stranger.auth)
      .expect(404);
  });

  it('refunds an online payment automatically when the customer cancels in time', async () => {
    const customer = await freshCustomer();
    const res = await hold(customer, at(19, 30), { paymentMethod: 'ONLINE' }).expect(201);
    const order = await payOrder(customer, res.body.bookingId).expect(201);
    await settle(customer, order.body.paymentId).expect(201);

    const cancelled = await http()
      .post(`/api/v1/bookings/${res.body.bookingId}/cancel`)
      .set('Authorization', customer.auth)
      .send({})
      .expect(201);

    expect(cancelled.body.refund.failed).toBe(false);
    expect(cancelled.body.refund.refundedPaise).toBeGreaterThan(0);
    const payment = await raw.payment.findUniqueOrThrow({ where: { id: order.body.paymentId } });
    expect(payment.status).toBe('REFUNDED');
  });

  it('refunds nothing online for a booking paid at the counter', async () => {
    const customer = await freshCustomer();
    const res = await hold(customer, at(20), { paymentMethod: 'COUNTER' }).expect(201);
    await http()
      .post(`/api/v1/admin/bookings/${res.body.bookingId}/mark-paid`)
      .set('Authorization', adminAuth)
      .send({ method: 'CASH' })
      .expect(201);

    const cancelled = await http()
      .post(`/api/v1/bookings/${res.body.bookingId}/cancel`)
      .set('Authorization', customer.auth)
      .send({})
      .expect(201);

    // Cash goes back across the counter, recorded by staff — never through the gateway.
    expect(cancelled.body.refund).toEqual({ refundedPaise: 0, failed: false });
  });

  /**
   * The trap that came with switching online payment on: the abandoned-cart job used to
   * cancel every unpaid shop order after half an hour, counter reservations included.
   */
  it('leaves counter shop orders alone and releases only abandoned online checkouts', async () => {
    const customer = await freshCustomer();
    const old = new Date(Date.now() - 60 * 60_000);
    const stamp = Date.now();

    const counterOrder = await raw.productOrder.create({
      data: { publicId: `ORD-TC${stamp}`, storeId, userId: customer.id, totalPaise: 9900, createdAt: old },
    });
    const onlineOrder = await raw.productOrder.create({
      data: { publicId: `ORD-TO${stamp}`, storeId, userId: customer.id, totalPaise: 9900, createdAt: old },
    });
    await raw.payment.create({
      data: {
        storeId,
        productOrderId: onlineOrder.id,
        gateway: 'RAZORPAY',
        gatewayOrderId: `order_test_${stamp}`,
        amountPaise: 9900,
      },
    });

    const { ProductJobs } = await import('../../src/products/product.jobs.js');
    await app.get(ProductJobs).releaseAbandonedOrders();

    const counterAfter = await raw.productOrder.findUniqueOrThrow({ where: { id: counterOrder.id } });
    const onlineAfter = await raw.productOrder.findUniqueOrThrow({ where: { id: onlineOrder.id } });
    expect(counterAfter.status).toBe('PENDING');
    expect(onlineAfter.status).toBe('CANCELLED');
  });
});
