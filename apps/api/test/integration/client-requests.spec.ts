import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { BookingStatus } from '@prisma/client';
import { TERMS } from '@reset/types';
import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { generatePublicId } from '../../src/booking/public-id.js';

/**
 * The client's requests of 11/09/2026, end to end over HTTP against a real database:
 * Terms & Conditions at booking, the menu's presentation fields, home banners, switching an
 * allocation rule on and off, earnings per station, and the help desk that replaces the
 * phone number.
 *
 * Over HTTP rather than by calling services, because half of what can go wrong here is in
 * the layer between — a validation pipe, a guard, a route that was never registered.
 */
process.env.PAYMENTS_ENABLED = 'false';

const raw = new PrismaClient();

interface Customer {
  readonly id: string;
  readonly auth: string;
}

describe('client requests of 11/09/2026', () => {
  let app: INestApplication;
  let issue: (claims: { sub: string; aud: 'customer' | 'admin'; role?: string; storeId?: string }) => string;
  let storeId: string;
  let timezone: string;
  let headId: string;
  let other: { id: string; slug: string; name: string };
  let stationIds: string[];
  let adminAuth: string;
  let date: string;
  let weekday: number;
  let sequence = 0;

  const http = () => request(app.getHttpServer());

  /** A new customer per test, so rate limits and the open-question cap never leak across. */
  async function freshCustomer(): Promise<Customer> {
    sequence += 1;
    const uid = `test-client-requests-${Date.now()}-${sequence}`;
    const phone = `+9191${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const user = await raw.user.create({
      data: { firebaseUid: uid, name: `Tester ${sequence}`, phone, consentAt: new Date() },
    });
    return { id: user.id, auth: `Bearer ${issue({ sub: user.id, aud: 'customer' })}` };
  }

  function at(hour: number, minute = 0): string {
    return DateTime.fromISO(date, { zone: timezone }).set({ hour, minute }).toISO()!;
  }

  function hold(customer: Customer, startsAt: string, extra: Record<string, unknown> = {}) {
    return http()
      .post('/api/v1/bookings/hold')
      .set('Authorization', customer.auth)
      .send({ serviceId: headId, startsAt, addonOptionIds: [], rewardId: null, ...extra });
  }

  async function slotCount(serviceId: string): Promise<number> {
    const res = await http()
      .get('/api/v1/availability/slots')
      .query({ serviceId, date })
      .expect(200);
    return (res.body.slots as unknown[]).length;
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
    other = await raw.service.findFirstOrThrow({
      where: { storeId, slug: { not: 'head' }, isActive: true, deletedAt: null },
      select: { id: true, slug: true, name: true },
      orderBy: { sortOrder: 'asc' },
    });

    stationIds = (
      await raw.station.findMany({
        where: { storeId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      })
    ).map((station) => station.id);

    const admin = await raw.adminUser.upsert({
      where: { email: 'client-requests-admin@test.reset.app' },
      create: {
        email: 'client-requests-admin@test.reset.app',
        passwordHash: 'not-a-password-hash',
        name: 'Desk Tester',
        role: 'OWNER',
        storeId,
      },
      update: { isActive: true, name: 'Desk Tester' },
    });
    adminAuth = `Bearer ${issue({ sub: admin.id, aud: 'admin', role: 'OWNER', storeId })}`;

    // Tomorrow, or the day after if tomorrow is the seed store's closed Monday.
    let cursor = DateTime.now().setZone(timezone).plus({ days: 1 }).startOf('day');
    while (cursor.weekday === 1) cursor = cursor.plus({ days: 1 });
    date = cursor.toISODate()!;
    weekday = cursor.weekday % 7;
  });

  beforeEach(async () => {
    await raw.supportThread.deleteMany({ where: { storeId } });
    await raw.banner.deleteMany({ where: { storeId } });
    await raw.allocationRule.deleteMany({ where: { storeId } });
    await raw.refund.deleteMany({ where: { payment: { storeId } } });
    await raw.payment.deleteMany({ where: { storeId } });
    await raw.booking.deleteMany({ where: { storeId } });
  });

  afterAll(async () => {
    await raw.supportThread.deleteMany({ where: { storeId } });
    await raw.banner.deleteMany({ where: { storeId } });
    await raw.allocationRule.deleteMany({ where: { storeId } });
    await raw.$disconnect();
    await app.close();
  });

  // ── Terms & Conditions ─────────────────────────────────────────────────────

  describe('terms & conditions', () => {
    it('serves the client’s wording to the app', async () => {
      const res = await http().get('/api/v1/catalog/terms').expect(200);
      expect(res.body.version).toBe(TERMS.version);
      expect(res.body.clauses).toHaveLength(6);
      expect(res.body.agreement).toContain('non-medical wellness services only');
    });

    it('records which version the customer agreed to, and when', async () => {
      const customer = await freshCustomer();
      const res = await hold(customer, at(12), { termsVersion: TERMS.version }).expect(201);

      const row = await raw.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
      expect(row.termsVersion).toBe(TERMS.version);
      expect(row.termsAcceptedAt).toBeInstanceOf(Date);
    });

    it('refuses agreement to wording that is no longer current — and books nothing', async () => {
      const customer = await freshCustomer();
      const res = await hold(customer, at(12, 30), { termsVersion: '2020-01-01' }).expect(422);

      expect(res.body.meta?.field).toBe('termsVersion');
      expect(await raw.booking.count({ where: { storeId } })).toBe(0);
    });

    it('still takes a booking from an app installed before the checkbox existed', async () => {
      const customer = await freshCustomer();
      const res = await hold(customer, at(13)).expect(201);

      const row = await raw.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
      expect(row.termsVersion).toBeNull();
      expect(row.termsAcceptedAt).toBeNull();
    });
  });

  // ── Menu presentation ──────────────────────────────────────────────────────

  describe('menu presentation', () => {
    it('carries emoji, tagline, badge and a genuine "was" price to the menu', async () => {
      const service = await raw.service.findUniqueOrThrow({ where: { id: headId } });
      const body = {
        categoryId: service.categoryId,
        name: service.name,
        slug: service.slug,
        description: service.description,
        imageUrl: service.imageUrl,
        pricePaise: service.pricePaise,
        durationMinutes: service.durationMinutes,
        bufferOverrideMinutes: service.bufferOverrideMinutes,
        maxPerSlot: service.maxPerSlot,
        sortOrder: service.sortOrder,
        isActive: service.isActive,
        emoji: '💆‍♂️',
        tagline: 'Head',
        compareAtPricePaise: service.pricePaise * 3,
        badge: 'BESTSELLER',
      };

      try {
        await http()
          .put(`/api/v1/admin/catalog/services/${headId}`)
          .set('Authorization', adminAuth)
          .send(body)
          .expect(200);

        const home = await http().get('/api/v1/catalog/home').expect(200);
        expect(home.body.services.find((s: { id: string }) => s.id === headId)).toMatchObject({
          emoji: '💆‍♂️',
          tagline: 'Head',
          badge: 'BESTSELLER',
          compareAtPricePaise: service.pricePaise * 3,
        });

        const detail = await http().get(`/api/v1/catalog/services/${service.slug}`).expect(200);
        expect(detail.body).toMatchObject({ emoji: '💆‍♂️', compareAtPricePaise: service.pricePaise * 3 });

        // Equal to the price is not a discount, and must never render as "0% off".
        await http()
          .put(`/api/v1/admin/catalog/services/${headId}`)
          .set('Authorization', adminAuth)
          .send({ ...body, compareAtPricePaise: service.pricePaise })
          .expect(200);
        const again = await http().get(`/api/v1/catalog/services/${service.slug}`).expect(200);
        expect(again.body.compareAtPricePaise).toBeNull();
      } finally {
        await raw.service.update({
          where: { id: headId },
          data: { emoji: null, tagline: null, compareAtPricePaise: null, badge: null },
        });
      }
    });
  });

  // ── Home banners ───────────────────────────────────────────────────────────

  describe('home banners', () => {
    const imageUrl = 'https://api.resetmen.in/media/store/banner.jpg';
    const altText = 'Head and neck massage at RESET, Pune';

    it('puts an active banner on the home screen, linked to its service', async () => {
      const created = await http()
        .post('/api/v1/admin/banners')
        .set('Authorization', adminAuth)
        .send({ imageUrl, altText, serviceId: headId })
        .expect(201);

      const home = await http().get('/api/v1/catalog/home').expect(200);
      expect(home.body.banners).toEqual([
        { id: created.body.id, imageUrl, altText, serviceSlug: 'head' },
      ]);
    });

    it('takes a banner off the home screen when it is switched off', async () => {
      const created = await http()
        .post('/api/v1/admin/banners')
        .set('Authorization', adminAuth)
        .send({ imageUrl, altText })
        .expect(201);

      await http()
        .put(`/api/v1/admin/banners/${created.body.id}`)
        .set('Authorization', adminAuth)
        .send({ imageUrl, altText, isActive: false })
        .expect(200);

      const home = await http().get('/api/v1/catalog/home').expect(200);
      expect(home.body.banners).toEqual([]);
    });

    it('will not link a banner to a service customers cannot open', async () => {
      await raw.service.update({ where: { id: other.id }, data: { isActive: false } });
      try {
        const res = await http()
          .post('/api/v1/admin/banners')
          .set('Authorization', adminAuth)
          .send({ imageUrl, altText, serviceId: other.id })
          .expect(422);
        expect(res.body.meta?.field).toBe('serviceId');
      } finally {
        await raw.service.update({ where: { id: other.id }, data: { isActive: true } });
      }
    });

    it('drops the link, not the banner, when its service is unpublished later', async () => {
      await http()
        .post('/api/v1/admin/banners')
        .set('Authorization', adminAuth)
        .send({ imageUrl, altText, serviceId: other.id })
        .expect(201);

      await raw.service.update({ where: { id: other.id }, data: { isActive: false } });
      try {
        const home = await http().get('/api/v1/catalog/home').expect(200);
        expect(home.body.banners).toHaveLength(1);
        expect(home.body.banners[0].serviceSlug).toBeNull();
      } finally {
        await raw.service.update({ where: { id: other.id }, data: { isActive: true } });
      }
    });

    it('is closed to customers', async () => {
      const customer = await freshCustomer();
      const res = await http().get('/api/v1/admin/banners').set('Authorization', customer.auth);
      expect([401, 403]).toContain(res.status);
    });

    /**
     * The round trip the admin form actually makes: upload, then save the URL the upload
     * returned. It failed in the browser — the upload answered with the path
     * `/api/v1/media/…`, which no other host can load and which the banner refused as
     * "Invalid url." — and passed every test above, because they all used a made-up URL.
     */
    it('saves a banner from a real upload, and serves the picture', async () => {
      const sharp = (await import('sharp')).default;
      const png = await sharp({
        create: { width: 320, height: 200, channels: 3, background: { r: 14, g: 159, b: 118 } },
      })
        .png()
        .toBuffer();

      const uploaded = await http()
        .post('/api/v1/admin/media')
        .set('Authorization', adminAuth)
        .attach('file', png, { filename: 'banner.png', contentType: 'image/png' })
        .expect(201);
      expect(uploaded.body.url).toMatch(/^https?:\/\/[^/]+\/api\/v1\/media\//);
      for (const url of Object.values(uploaded.body.variants as Record<string, string>)) {
        expect(url).toMatch(/^https?:\/\//);
      }

      await http()
        .post('/api/v1/admin/banners')
        .set('Authorization', adminAuth)
        .send({ imageUrl: uploaded.body.url, altText })
        .expect(201);

      const path = new URL(uploaded.body.url).pathname;
      const image = await http().get(path).expect(200);
      expect(image.headers['content-type']).toContain('image/png');
    });
  });

  // ── Allocation rules ───────────────────────────────────────────────────────

  describe('allocation rule on/off', () => {
    it('pauses and resumes a rule without editing it — and the reserved service keeps its times', async () => {
      const otherOpen = await slotCount(other.id);
      const headOpen = await slotCount(headId);
      expect(otherOpen).toBeGreaterThan(0);
      expect(headOpen).toBeGreaterThan(0);

      // Every station, all day, for Head only — the shape of the owner's "head" rule.
      const rule = await raw.allocationRule.create({
        data: {
          storeId,
          name: 'Head only, all day',
          mode: 'EXCLUSIVE_TO',
          recurrence: 'WEEKLY',
          daysOfWeek: [weekday],
          startsAtLocal: new Date('1970-01-01T00:00:00Z'),
          endsAtLocal: new Date('1970-01-01T23:59:00Z'),
          stations: { create: stationIds.map((stationId) => ({ stationId })) },
          services: { create: [{ serviceId: headId }] },
        },
      });

      expect(await slotCount(other.id)).toBe(0);
      // The service the stations are reserved *for* must lose nothing.
      expect(await slotCount(headId)).toBe(headOpen);

      const off = await http()
        .put(`/api/v1/admin/allocation-rules/${rule.id}/active`)
        .set('Authorization', adminAuth)
        .send({ isActive: false })
        .expect(200);
      expect(off.body).toMatchObject({ id: rule.id, isActive: false });
      expect(await slotCount(other.id)).toBe(otherOpen);

      const list = await http()
        .get('/api/v1/admin/allocation-rules')
        .set('Authorization', adminAuth)
        .expect(200);
      expect(list.body.find((r: { id: string }) => r.id === rule.id).isActive).toBe(false);

      await http()
        .put(`/api/v1/admin/allocation-rules/${rule.id}/active`)
        .set('Authorization', adminAuth)
        .send({ isActive: true })
        .expect(200);
      expect(await slotCount(other.id)).toBe(0);
    });

    it('404s for a rule that does not exist', async () => {
      await http()
        .put('/api/v1/admin/allocation-rules/00000000-0000-4000-8000-000000000000/active')
        .set('Authorization', adminAuth)
        .send({ isActive: false })
        .expect(404);
    });
  });

  // ── Earnings per station ───────────────────────────────────────────────────

  describe('earnings per station', () => {
    it('credits realised sessions and their refunds to the station that did the work', async () => {
      expect(stationIds.length).toBeGreaterThanOrEqual(2);
      const [a, b] = stationIds as [string, string];
      const customer = await freshCustomer();
      const day = DateTime.now().setZone(timezone).minus({ days: 2 }).startOf('day');

      const book = (
        stationId: string,
        hour: number,
        status: BookingStatus,
        serviceId: string,
        name: string,
        base: number,
        discount = 0,
      ) =>
        raw.booking.create({
          data: {
            publicId: generatePublicId(),
            storeId,
            userId: customer.id,
            serviceId,
            stationId,
            status,
            source: 'APP',
            startsAt: day.set({ hour }).toJSDate(),
            endsAt: day.set({ hour, minute: 20 }).toJSDate(),
            blockedUntil: day.set({ hour, minute: 25 }).toJSDate(),
            totalDurationMinutes: 20,
            serviceNameSnapshot: name,
            basePricePaise: base,
            discountPaise: discount,
            payablePaise: base - discount,
          },
        });

      const refundOn = async (bookingId: string, amountPaise: number) => {
        const payment = await raw.payment.create({
          data: {
            storeId,
            bookingId,
            gateway: 'COUNTER',
            gatewayOrderId: `counter:test-${bookingId}`,
            amountPaise,
            status: 'CAPTURED',
            method: 'CASH',
          },
        });
        await raw.refund.create({
          data: { paymentId: payment.id, amountPaise, status: 'PROCESSED', reason: 'test' },
        });
      };

      const a1 = await book(a, 10, 'COMPLETED', headId, 'Head', 5_900);
      await book(a, 11, 'COMPLETED', other.id, other.name, 19_900, 2_000);
      const cancelled = await book(a, 12, 'CANCELLED', headId, 'Head', 5_900);
      await book(a, 13, 'NO_SHOW', headId, 'Head', 5_900);
      await book(b, 10, 'CHECKED_IN', headId, 'Head', 9_900);

      await refundOn(a1.id, 5_900);
      // A refund for a session that never happened was never earnings. It must not dock
      // station A a second time.
      await refundOn(cancelled.id, 5_900);

      const iso = day.toISODate()!;
      const res = await http()
        .get('/api/v1/admin/reports/stations')
        .query({ from: iso, to: iso })
        .set('Authorization', adminAuth)
        .expect(200);

      const rowA = res.body.byStation.find((s: { stationId: string }) => s.stationId === a);
      const rowB = res.body.byStation.find((s: { stationId: string }) => s.stationId === b);

      expect(rowA).toMatchObject({
        sessionCount: 2,
        grossPaise: 25_800,
        discountPaise: 2_000,
        netPaise: 23_800,
        refundedPaise: 5_900,
        earnedPaise: 17_900,
        averagePerSessionPaise: 8_950,
        sharePercent: 64.4,
      });
      expect(rowA.byService).toHaveLength(2);
      expect(rowB).toMatchObject({ sessionCount: 1, netPaise: 9_900, earnedPaise: 9_900, sharePercent: 35.6 });
      expect(res.body.earnedPaise).toBe(27_800);

      const csv = await http()
        .get('/api/v1/admin/reports/export')
        .query({ report: 'stations', from: iso, to: iso })
        .set('Authorization', adminAuth)
        .expect(200);
      expect(csv.text).toContain('Station,Sessions,Minutes,Gross,Discounts,Net,Refunded,Earned');
      expect(csv.text).toContain('179.00');
    });
  });

  // ── Help desk ──────────────────────────────────────────────────────────────

  describe('help desk', () => {
    const ask = (customer: Customer, body: Record<string, unknown>) =>
      http().post('/api/v1/support/threads').set('Authorization', customer.auth).send(body);

    const unreadAtDesk = async (): Promise<number> =>
      (await http().get('/api/v1/admin/support/unread-count').set('Authorization', adminAuth).expect(200))
        .body.count;

    it('carries a question to the desk and the answer back to the customer', async () => {
      const customer = await freshCustomer();

      const created = await ask(customer, {
        subject: 'Oil allergy',
        body: 'Can I have the session without any oil?',
      }).expect(201);
      expect(created.body.publicId).toMatch(/^HLP-[2-9A-Z]{6}$/);
      expect(created.body).toMatchObject({ status: 'OPEN', unread: false });
      expect(created.body.messages).toHaveLength(1);
      const id: string = created.body.id;

      // New at the desk…
      expect(await unreadAtDesk()).toBe(1);
      const list = await http().get('/api/v1/admin/support').set('Authorization', adminAuth).expect(200);
      expect(list.body.data[0]).toMatchObject({ id, unread: true, customer: { id: customer.id } });

      // …until someone opens it.
      await http().get(`/api/v1/admin/support/${id}`).set('Authorization', adminAuth).expect(200);
      expect(await unreadAtDesk()).toBe(0);

      const replied = await http()
        .post(`/api/v1/admin/support/${id}/messages`)
        .set('Authorization', adminAuth)
        .send({ body: 'Of course — just tell the attendant when you sit down.' })
        .expect(201);
      expect(replied.body.messages.at(-1)).toMatchObject({ author: 'STAFF', staffName: 'Desk Tester' });

      const mine = await http().get('/api/v1/support/threads').set('Authorization', customer.auth).expect(200);
      expect(mine.body.data[0]).toMatchObject({ id, unread: true, lastMessageBy: 'STAFF' });

      // A push was attempted. It is fire-and-forget, so give it a moment.
      let pushed = 0;
      for (let i = 0; i < 30 && pushed === 0; i += 1) {
        pushed = await raw.notificationLog.count({
          where: { userId: customer.id, template: 'support_reply' },
        });
        if (pushed === 0) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(pushed).toBeGreaterThan(0);

      // The customer reads it: the dot clears, and staff names stay inside the store.
      const opened = await http()
        .get(`/api/v1/support/threads/${id}`)
        .set('Authorization', customer.auth)
        .expect(200);
      expect(opened.body.messages.at(-1)).not.toHaveProperty('staffName');
      const after = await http().get('/api/v1/support/threads').set('Authorization', customer.auth);
      expect(after.body.data[0].unread).toBe(false);
    });

    it('keeps one customer out of another’s questions', async () => {
      const owner = await freshCustomer();
      const stranger = await freshCustomer();
      const created = await ask(owner, { subject: 'Parking', body: 'Is there parking nearby?' }).expect(201);

      await http().get(`/api/v1/support/threads/${created.body.id}`).set('Authorization', stranger.auth).expect(404);
      await http()
        .post(`/api/v1/support/threads/${created.body.id}/messages`)
        .set('Authorization', stranger.auth)
        .send({ body: 'hello' })
        .expect(404);
      const theirs = await http().get('/api/v1/support/threads').set('Authorization', stranger.auth).expect(200);
      expect(theirs.body.data).toEqual([]);
    });

    it('reopens a solved question when the customer writes again', async () => {
      const customer = await freshCustomer();
      const created = await ask(customer, { subject: 'Timing', body: 'Open on Sunday?' }).expect(201);
      const id: string = created.body.id;
      await http().get(`/api/v1/admin/support/${id}`).set('Authorization', adminAuth).expect(200);

      const closed = await http()
        .post(`/api/v1/support/threads/${id}/close`)
        .set('Authorization', customer.auth)
        .expect(201);
      expect(closed.body.status).toBe('CLOSED');

      const reopened = await http()
        .post(`/api/v1/support/threads/${id}/messages`)
        .set('Authorization', customer.auth)
        .send({ body: 'Actually, one more thing.' })
        .expect(201);
      expect(reopened.body.status).toBe('OPEN');
      expect(await unreadAtDesk()).toBe(1);
    });

    it('lets the desk close a question, and files it under Closed', async () => {
      const customer = await freshCustomer();
      const created = await ask(customer, { subject: 'Gift card', body: 'Do you sell gift cards?' }).expect(201);

      const res = await http()
        .put(`/api/v1/admin/support/${created.body.id}/status`)
        .set('Authorization', adminAuth)
        .send({ status: 'CLOSED' })
        .expect(200);
      expect(res.body.status).toBe('CLOSED');

      const open = await http().get('/api/v1/admin/support').query({ status: 'OPEN' }).set('Authorization', adminAuth);
      const closed = await http().get('/api/v1/admin/support').query({ status: 'CLOSED' }).set('Authorization', adminAuth);
      expect(open.body.data).toEqual([]);
      expect(closed.body.data).toHaveLength(1);
    });

    it('links a question to the customer’s own booking, and only their own', async () => {
      const customer = await freshCustomer();
      const stranger = await freshCustomer();

      const mine = await hold(customer, at(15)).expect(201);
      const theirs = await hold(stranger, at(16)).expect(201);

      const linked = await ask(customer, {
        subject: 'My booking',
        body: 'Can I bring a friend?',
        bookingId: mine.body.bookingId,
      }).expect(201);
      expect(linked.body.booking).toMatchObject({ id: mine.body.bookingId, publicId: mine.body.publicId });

      const refused = await ask(customer, {
        subject: 'Not mine',
        body: 'About this booking',
        bookingId: theirs.body.bookingId,
      }).expect(422);
      expect(refused.body.meta?.field).toBe('bookingId');
    });

    it('holds a customer to five open questions at once', async () => {
      const customer = await freshCustomer();
      for (let i = 1; i <= 5; i += 1) {
        await ask(customer, { subject: `Question ${i}`, body: 'Hello' }).expect(201);
      }
      const sixth = await ask(customer, { subject: 'Question 6', body: 'Hello' }).expect(422);
      expect(sixth.body.detail).toContain('5 open questions');
    });

    it('refuses an empty message and a subject too short to mean anything', async () => {
      const customer = await freshCustomer();
      await ask(customer, { subject: 'Valid subject', body: '   ' }).expect(422);
      await ask(customer, { subject: 'ab', body: 'Hello' }).expect(422);
    });

    it('requires a customer to be signed in, and keeps customers out of the desk', async () => {
      await http().get('/api/v1/support/threads').expect(401);

      const customer = await freshCustomer();
      const res = await http().get('/api/v1/admin/support').set('Authorization', customer.auth);
      expect([401, 403]).toContain(res.status);
    });
  });
});
