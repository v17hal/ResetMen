import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The booking flow with online payment switched off.
 *
 * This is how the store actually runs: money is taken at the counter, so there is nothing
 * for a hold to wait for. The behaviour under test is that a hold is *confirmed* on
 * creation — because if it were left HELD, the expiry job would quietly cancel a real
 * booking ten minutes later and the customer would arrive to nothing.
 *
 * `PAYMENTS_ENABLED` is set before the module is built, since the controller reads it once
 * at construction. Vitest isolates each spec file in its own worker, so this does not leak
 * into the suites that need payments on.
 */
process.env.PAYMENTS_ENABLED = 'false';

const raw = new PrismaClient();

describe('booking with payments disabled', () => {
  let app: INestApplication;
  let token: string;
  let storeId: string;
  let serviceId: string;
  let timezone: string;

  beforeAll(async () => {
    // Imported after the env is set, so loadEnv() inside the module graph sees 'false'.
    const { AppModule } = await import('../../src/app.module.js');
    const { ProblemJsonFilter } = await import('../../src/common/problem-json.filter.js');
    const { TokenService } = await import('../../src/auth/token.service.js');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ProblemJsonFilter());
    await app.init();

    const store = await raw.store.findFirstOrThrow({ where: { slug: 'reset-satellite' } });
    storeId = store.id;
    timezone = store.timezone;
    serviceId = (await raw.service.findFirstOrThrow({ where: { storeId, slug: 'head' } })).id;

    const user = await raw.user.upsert({
      where: { firebaseUid: 'test-payments-disabled' },
      create: {
        firebaseUid: 'test-payments-disabled',
        email: 'payments-disabled@test.reset.app',
        name: 'Counter Payer',
        // The API refuses an app booking from an account with no number to ring.
        phone: '+919100000011',
        consentAt: new Date(),
      },
      update: { phone: '+919100000011' },
    });

    token = app.get(TokenService).issueAccess({ sub: user.id, aud: 'customer' });
  });

  afterAll(async () => {
    await raw.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await raw.booking.deleteMany({ where: { storeId } });
  });

  /** A slot far enough ahead that lead time and store hours are never the reason for a 4xx. */
  function nextSlot(offsetMinutes = 0): string {
    return DateTime.now()
      .setZone(timezone)
      .plus({ days: 1 })
      .set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
      .plus({ minutes: offsetMinutes })
      .toISO()!;
  }

  it('confirms the booking on creation, with no payment step', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/bookings/hold')
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceId, startsAt: nextSlot(), addonOptionIds: [], rewardId: null })
      .expect(201);

    expect(response.body.status).toBe('CONFIRMED');
    expect(response.body.paymentRequired).toBe(false);

    const stored = await raw.booking.findUniqueOrThrow({
      where: { id: response.body.bookingId },
    });
    expect(stored.status).toBe('CONFIRMED');
  });

  /**
   * The QR arrives with the money, not with the booking.
   *
   * This test used to expect the code the instant the slot was taken. That was changed on
   * purpose: a code on screen told the customer they were done and gave the counter
   * something to scan for a visit nobody had paid for.
   */
  it('withholds the check-in QR until the counter marks the booking paid', async () => {
    const hold = await request(app.getHttpServer())
      .post('/api/v1/bookings/hold')
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceId, startsAt: nextSlot(30), addonOptionIds: [], rewardId: null })
      .expect(201);

    const before = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${hold.body.bookingId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(before.body.checkinPayload).toBeNull();

    // What "Mark paid" on the Payments due screen writes.
    const booking = await raw.booking.findUniqueOrThrow({ where: { id: hold.body.bookingId } });
    await raw.payment.create({
      data: {
        storeId,
        bookingId: booking.id,
        gateway: 'COUNTER',
        gatewayOrderId: `counter:${booking.publicId}`,
        amountPaise: booking.payablePaise,
        status: 'CAPTURED',
        method: 'CASH',
      },
    });

    const after = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${hold.body.bookingId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body.checkinPayload).toBeTruthy();
  });

  it('survives the hold-expiry job — the booking is no longer HELD', async () => {
    const hold = await request(app.getHttpServer())
      .post('/api/v1/bookings/hold')
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceId, startsAt: nextSlot(60), addonOptionIds: [], rewardId: null })
      .expect(201);

    // Wind the hold window into the past. Under the old behaviour this booking would still
    // be HELD and the sweep would cancel it out from under a customer who had already been
    // told they were booked.
    await raw.booking.update({
      where: { id: hold.body.bookingId },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });

    await raw.booking.updateMany({
      where: { storeId, status: 'HELD', holdExpiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });

    const after = await raw.booking.findUniqueOrThrow({
      where: { id: hold.body.bookingId },
    });
    expect(after.status).toBe('CONFIRMED');
  });

  it('refuses an anonymous booking, because there would be nobody to send the QR to', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/bookings/hold')
      .send({ serviceId, startsAt: nextSlot(90), addonOptionIds: [], rewardId: null })
      .expect(401);
  });

  it('still refuses to double-book a station', async () => {
    const startsAt = nextSlot(120);

    // Fill every station at that time, then prove the next one is refused. The exclusion
    // constraint does not care whether payment is involved.
    //
    // A different customer per station: one customer may not hold two overlapping slots,
    // so a single account filling the store would be refused on its second booking for a
    // reason that has nothing to do with capacity.
    const stations = await raw.station.count({ where: { storeId, isActive: true } });

    // Imported the same way as in beforeAll: after PAYMENTS_ENABLED is set.
    const { TokenService } = await import('../../src/auth/token.service.js');

    const tokenFor = async (n: number): Promise<string> => {
      const uid = `test-payments-disabled-${n}`;
      const phone = `+91910000${String(100 + n).padStart(4, '0')}`;
      const user = await raw.user.upsert({
        where: { firebaseUid: uid },
        create: { firebaseUid: uid, name: `Station Filler ${n}`, phone, consentAt: new Date() },
        update: { phone },
      });
      return app.get(TokenService).issueAccess({ sub: user.id, aud: 'customer' });
    };

    for (let i = 0; i < stations; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/bookings/hold')
        .set('Authorization', `Bearer ${await tokenFor(i)}`)
        .send({ serviceId, startsAt, addonOptionIds: [], rewardId: null })
        .expect(201);
    }

    const overflow = await request(app.getHttpServer())
      .post('/api/v1/bookings/hold')
      .set('Authorization', `Bearer ${await tokenFor(stations)}`)
      .send({ serviceId, startsAt, addonOptionIds: [], rewardId: null });

    expect(overflow.status).toBe(409);
    expect(overflow.body.code).toMatch(/SLOT_TAKEN|SLOT_UNAVAILABLE/);
  });
});
