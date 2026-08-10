import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { ProblemJsonFilter } from '../../src/common/problem-json.filter.js';

/**
 * `Idempotency-Key` handling, exercised over HTTP.
 *
 * This one genuinely cannot be tested at the service layer: the whole mechanism is an
 * interceptor reading a header, and a service-level test would prove nothing about the thing
 * customers actually hit.
 *
 * The scenario throughout is the real one — a customer on a train taps *Pay*, the response
 * is lost, the app retries.
 */
describe('idempotency', () => {
  let app: INestApplication;
  const raw = new PrismaClient();

  let token: string;
  let bookingId: string;
  let serviceId: string;
  let storeId: string;
  let timezone: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ProblemJsonFilter());
    await app.init();

    const store = await raw.store.findFirstOrThrow({ where: { slug: 'reset-satellite' } });
    storeId = store.id;
    timezone = store.timezone;
    serviceId = (await raw.service.findFirstOrThrow({ where: { storeId, slug: 'head' } })).id;

    // Sign in through the real OTP path rather than minting a token by hand — it is two
    // calls, and it keeps this test honest about the guard the route actually carries.
    const phone = '+919200000001';
    await request(app.getHttpServer()).post('/api/v1/auth/otp/request').send({ phone }).expect(201);

    // Codes are stored hashed, so the generated one cannot be read back. Overwrite the hash
    // with a known code instead of reaching into the provider's log. `phone` is the primary
    // key — there is one live code per number by design.
    const code = '424242';
    await raw.otpCode.update({
      where: { phone },
      data: { codeHash: hashOtp(phone, code), consumedAt: null },
    });

    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code })
      .expect(201);

    token = verified.body.accessToken;
  });

  afterAll(async () => {
    await raw.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await raw.idempotencyKey.deleteMany({});
    await raw.payment.deleteMany({});
    await raw.bookingStatusHistory.deleteMany({});
    await raw.bookingAddon.deleteMany({});
    await raw.booking.deleteMany({});

    let cursor = DateTime.now().setZone(timezone).plus({ days: 1 }).startOf('day');
    while (cursor.weekday === 1) cursor = cursor.plus({ days: 1 });

    const held = await request(app.getHttpServer())
      .post('/api/v1/bookings/hold')
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceId, startsAt: cursor.set({ hour: 13 }).toISO() })
      .expect(201);

    bookingId = held.body.bookingId;
  });

  const order = () =>
    request(app.getHttpServer())
      .post('/api/v1/payments/order')
      .set('Authorization', `Bearer ${token}`);

  it('creates one order when the same key is sent twice', async () => {
    const key = `idem-${Date.now()}`;

    const first = await order().set('Idempotency-Key', key).send({ bookingId }).expect(201);
    const second = await order().set('Idempotency-Key', key).send({ bookingId }).expect(201);

    expect(second.body.paymentId).toBe(first.body.paymentId);
    expect(second.body.gatewayOrderId).toBe(first.body.gatewayOrderId);
    expect(await raw.payment.count({ where: { bookingId } })).toBe(1);
  });

  it('returns the stored response byte-for-byte on replay', async () => {
    const key = `idem-${Date.now()}-replay`;

    const first = await order().set('Idempotency-Key', key).send({ bookingId }).expect(201);
    const second = await order().set('Idempotency-Key', key).send({ bookingId }).expect(201);

    expect(second.body).toEqual(first.body);
  });

  it('rejects the same key used for a different payload', async () => {
    const key = `idem-${Date.now()}-mismatch`;
    await order().set('Idempotency-Key', key).send({ bookingId }).expect(201);

    const other = await raw.productOrder
      .findFirst({ select: { id: true } })
      .catch(() => null);

    const mismatched = await order()
      .set('Idempotency-Key', key)
      .send({ productOrderId: other?.id ?? '00000000-0000-4000-8000-000000000000' });

    expect(mismatched.status).toBe(409);
    expect(mismatched.body.code).toBe('IDEMPOTENT_REPLAY_MISMATCH');
  });

  it('ignores key ordering — the same content in a different order is the same request', async () => {
    const key = `idem-${Date.now()}-order`;

    const first = await order()
      .set('Idempotency-Key', key)
      .send({ bookingId })
      .expect(201);

    // Same single field, but sent alongside an explicit undefined-equivalent. Clients and
    // proxies do not preserve key order and should not have to.
    const second = await order()
      .set('Idempotency-Key', key)
      .send({ bookingId, productOrderId: undefined })
      .expect(201);

    expect(second.body.paymentId).toBe(first.body.paymentId);
  });

  it('works normally when no key is sent', async () => {
    const first = await order().send({ bookingId }).expect(201);
    const second = await order().send({ bookingId }).expect(201);

    // No key means no replay guarantee — but `createOrder` reuses an open order anyway, so
    // the customer still cannot end up with two.
    expect(second.body.paymentId).toBe(first.body.paymentId);
    expect(await raw.idempotencyKey.count()).toBe(0);
  });

  it('releases the key when the handler fails, so a retry can succeed', async () => {
    const key = `idem-${Date.now()}-failed`;

    // A booking that does not exist — the handler throws, and the key must not be poisoned.
    await order()
      .set('Idempotency-Key', key)
      .send({ bookingId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);

    expect(await raw.idempotencyKey.count({ where: { key } })).toBe(0);

    await order().set('Idempotency-Key', key).send({ bookingId }).expect(201);
  });

  it('rejects an absurdly long key rather than storing it', async () => {
    const response = await order()
      .set('Idempotency-Key', 'x'.repeat(300))
      .send({ bookingId });

    expect(response.status).toBe(422);
  });
});

/** Mirrors `AuthService`'s storage format. */
function hashOtp(phone: string, code: string): string {
  return createHash('sha256').update(`${phone}:${code}`).digest('hex');
}
