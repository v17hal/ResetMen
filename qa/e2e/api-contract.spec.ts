import { expect, test } from '@playwright/test';

import {
  API,
  type Customer,
  adminToken,
  catalogue,
  createCustomer,
  deleteCustomer,
  firstOpenDay,
  setPhone,
} from './support';

/**
 * The API contract the apps are written against, asserted directly.
 *
 * Not a browser in sight. Four separate bugs in one week came from a client declaring a
 * field the API had never sent — `customers.get`, `reorder`, `allocationRules`, the station
 * list — and every one was invisible until somebody opened the screen it broke. A Dart model
 * is worse again: Flutter parses defensively, so a field the server stopped sending becomes
 * `false` or `0` rather than an error, and the app quietly shows the wrong thing.
 *
 * So these assert the fields the Android app parses, against the live API. If the server
 * changes shape, this fails here rather than in somebody's hand.
 */

/** The signed-in surfaces need a customer; each test cleans up the one it made. */
let customer: Customer | undefined;

test.afterEach(async ({ request }) => {
  if (customer !== undefined) {
    await deleteCustomer(request, customer);
    customer = undefined;
  }
});

test.describe('Store', () => {
  test('TC-200 the store carries the details the app and the markup need', async ({
    request,
  }) => {
    const store = await (await request.get(`${API}/catalog/store`)).json();

    expect(store.name, 'the shop needs a name').toBeTruthy();
    expect(store.timezone).toBe('Asia/Kolkata');
    expect(typeof store.paymentsEnabled).toBe('boolean');

    // The whole payment-at-the-counter flow hangs off this being false. If it ever flips,
    // both apps change behaviour and this test is the warning.
    expect(store.paymentsEnabled, 'there is no gateway').toBe(false);

    // Name, address and phone are what the LocalBusiness markup is built from, and what a
    // customer rings. Empty means the schema silently downgrades to Organization.
    expect(store.address, 'no address means no map listing').toBeTruthy();
    expect(store.phone, 'no phone means no click-to-call and no LocalBusiness').toBeTruthy();
    expect(store.city).toBeTruthy();
    expect(Array.isArray(store.hours)).toBe(true);
  });
});

test.describe('Booking contract', () => {
  test('TC-201 an anonymous booking is refused, with a reason', async ({ request }) => {
    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    const response = await request.post(`${API}/bookings/hold`, {
      data: { serviceId: head.id, startsAt: slots[0]!.startsAt, addonIds: [] },
    });

    // With payment at the counter there is nothing for an anonymous hold to wait for, so
    // the API refuses before taking the slot. The Android checkout now signs in first
    // rather than meeting this.
    expect(response.status()).toBe(401);
  });

  test('TC-202 booking without a phone is refused, and says which field', async ({
    request,
  }) => {
    // Deliberately no phone: this is the state a brand-new Google sign-in is in.
    customer = await createCustomer(request);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    const response = await request.post(`${API}/bookings/hold`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
      data: { serviceId: head.id, startsAt: slots[1]!.startsAt, addonIds: [] },
    });

    expect(response.status()).toBe(422);

    const problem = await response.json();
    expect(problem.code).toBe('VALIDATION_FAILED');

    /**
     * The field name, which is the whole point.
     *
     * VALIDATION_FAILED covers a malformed date and a missing phone alike, so the code
     * alone cannot tell an app which one happened. Both clients read `meta.field` to decide
     * whether to show a phone prompt or just the sentence — the Dart client did not parse
     * `meta` at all until now, so Android could only show the message and stop.
     */
    expect(problem.meta?.field).toBe('phone');
    expect(problem.detail, 'and a sentence worth showing').toBeTruthy();
  });

  test('TC-203 a booking reports whether it has been paid for', async ({ request }) => {
    customer = await createCustomer(request);
    await setPhone(request, customer);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    const made = await request.post(`${API}/bookings/hold`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
      data: { serviceId: head.id, startsAt: slots[2]!.startsAt, addonIds: [] },
    });
    expect(made.ok()).toBeTruthy();
    const { bookingId } = (await made.json()) as { bookingId: string };

    const detail = await (
      await request.get(`${API}/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${customer.accessToken}` },
      })
    ).json();

    // Every field the Dart Booking model requires. A missing one parses to a default and
    // shows the customer something untrue rather than failing.
    for (const field of [
      'id',
      'publicId',
      'status',
      'isPaid',
      'serviceName',
      'startsAt',
      'endsAt',
      'durationMinutes',
      'payablePaise',
      'addons',
      'canCancel',
    ]) {
      expect(detail, `the app parses ${field}`).toHaveProperty(field);
    }

    expect(typeof detail.isPaid).toBe('boolean');
    expect(detail.isPaid, 'a fresh booking is unpaid — nobody has been to the counter').toBe(
      false,
    );

    // No entry code until the money is in. This is what the app gates the QR on, and why
    // an unpaid booking says "awaiting confirmation" instead.
    expect(detail.checkinPayload, 'no QR before payment').toBeNull();

    // Confirmed, not held: with payments off there is nothing for a hold to wait for, and
    // a HELD booking would be cancelled by the expiry job under the customer.
    expect(detail.status).toBe('CONFIRMED');
  });

  test('TC-204 a clashing booking names the booking it clashes with', async ({ request }) => {
    customer = await createCustomer(request);
    await setPhone(request, customer);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const longer = services.find((s) => s.name === 'Head + Neck + Shoulder')!;
    const { slots } = await firstOpenDay(request, head.id);

    const first = await request.post(`${API}/bookings/hold`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
      data: { serviceId: head.id, startsAt: slots[3]!.startsAt, addonIds: [] },
    });
    expect(first.ok()).toBeTruthy();

    // The same start, a longer service: overlaps a booking this customer already holds.
    const clash = await request.post(`${API}/bookings/hold`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
      data: { serviceId: longer.id, startsAt: slots[3]!.startsAt, addonIds: [] },
    });

    expect(clash.status()).toBe(409);

    const problem = await clash.json();
    /**
     * The reason matters more than the refusal.
     *
     * This code covers two situations — somebody else took the slot, or it overlaps one of
     * your own bookings — and only the server knows which. Both apps show `detail` verbatim
     * for exactly this case. Telling a customer "that time has just been taken" when the
     * thing in the way is their own appointment sends them hunting for a problem that is
     * not there.
     */
    expect(problem.detail, 'the sentence should name the customer\'s own booking').toMatch(
      /RST[A-Z0-9]+|overlaps/i,
    );
  });
});

test.describe('Shop contract', () => {
  test('TC-205 the shelf carries every field the app renders', async ({ request }) => {
    const body = await (await request.get(`${API}/products`)).json();

    expect(body, 'the list is wrapped in { data }').toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);

    if (body.data.length === 0) {
      test.skip(true, 'no products stocked — nothing to check the shape of');
      return;
    }

    const product = body.data[0];
    for (const field of ['id', 'name', 'slug', 'pricePaise', 'inStock']) {
      expect(product, `the app parses ${field}`).toHaveProperty(field);
    }

    // A flag rather than a count, deliberately: a competitor should not be able to read
    // the shelf. The app shows "Out of stock" from this and never a number.
    expect(typeof product.inStock).toBe('boolean');
    expect(product).not.toHaveProperty('stockQty');
  });

  test('TC-206 an order is placed unpaid, and cancelling returns the stock', async ({
    request,
  }) => {
    const products = (await (await request.get(`${API}/products`)).json()).data as Array<{
      id: string;
      name: string;
      inStock: boolean;
    }>;

    const available = products.find((p) => p.inStock);
    if (available === undefined) {
      test.skip(true, 'nothing in stock to order');
      return;
    }

    customer = await createCustomer(request);
    await setPhone(request, customer);

    const placed = await request.post(`${API}/orders`, {
      headers: {
        Authorization: `Bearer ${customer.accessToken}`,
        'Idempotency-Key': `qa-order-${Date.now()}`,
      },
      data: { items: [{ productId: available.id, qty: 1 }] },
    });
    expect(placed.ok(), await placed.text()).toBeTruthy();

    const order = await placed.json();
    for (const field of ['id', 'publicId', 'status', 'totalPaise', 'createdAt', 'items']) {
      expect(order, `the app parses ${field}`).toHaveProperty(field);
    }

    /**
     * PENDING, and it stays there.
     *
     * There is no gateway, so nothing can move an order to PAID except a member of staff
     * recording the money at the counter. The app turns this status into "Pay at the
     * store"; the website used to run a payment path here that returned a 500 in
     * production, after the stock had already left the shelf.
     */
    expect(order.status).toBe('PENDING');
    expect(order.items[0].qty).toBe(1);

    // Put it back. This runs against the live shop, so the test cleans up the stock it
    // took rather than leaving the shelf short by one.
    const token = await adminToken(request);
    const cancelled = await request.post(
      `${API}/admin/products/orders/${order.id}/status`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { status: 'CANCELLED', reason: 'QA contract test' },
      },
    );
    expect(cancelled.ok(), 'the test must return the stock it took').toBeTruthy();
  });
});

test.describe('Serving a booking', () => {
  /** Books a slot for a fresh customer and returns its ids. */
  async function book(request: Parameters<typeof createCustomer>[0], slotIndex: number) {
    customer = await createCustomer(request);
    await setPhone(request, customer);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    const made = await request.post(`${API}/bookings/hold`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
      data: { serviceId: head.id, startsAt: slots[slotIndex]!.startsAt, addonIds: [] },
    });
    expect(made.ok(), await made.text()).toBeTruthy();
    return (await made.json()) as { bookingId: string; publicId: string };
  }

  test('TC-207 an unpaid booking cannot be served', async ({ request }) => {
    const { bookingId } = await book(request, 4);
    const token = await adminToken(request);

    /**
     * The hole this closes: the check-in scanner has always refused an unpaid booking, and
     * the status dropdown beside it did not. Staff could take a booking straight to
     * CHECKED_IN or COMPLETED and hand over a free treatment, and it would never appear on
     * Payments due again.
     */
    for (const status of ['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED']) {
      const response = await request.post(`${API}/admin/bookings/${bookingId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { status },
      });

      expect(response.status(), `${status} on an unpaid booking should be refused`).toBe(422);

      /**
       * Only CHECKED_IN is refused *for being unpaid*.
       *
       * The booking is still CONFIRMED — the refusals leave it where it was — and the state
       * machine will not go CONFIRMED → IN_PROGRESS or → COMPLETED at all, so those two are
       * stopped a step earlier and say so. Demanding the payment wording for all three
       * asserted an implementation detail rather than the behaviour, and failed on a
       * refusal that was entirely correct.
       */
      if (status === 'CHECKED_IN') {
        expect((await response.json()).detail).toMatch(/paid/i);
      }
    }

    // Marking a no-show must still work — it is the likeliest outcome for an unpaid booking.
    const noShow = await request.post(`${API}/admin/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'NO_SHOW' },
    });
    expect(noShow.ok(), 'NO_SHOW must stay available on an unpaid booking').toBeTruthy();
  });

  test('TC-208 a booking cannot be completed before it starts', async ({ request }) => {
    const { bookingId } = await book(request, 5);
    const token = await adminToken(request);

    await request.post(`${API}/admin/bookings/${bookingId}/mark-paid`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { method: 'CASH' },
    });

    // Early check-in is fine — people arrive early.
    const checkIn = await request.post(`${API}/admin/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'CHECKED_IN' },
    });
    expect(checkIn.ok(), 'checking somebody in early is legitimate').toBeTruthy();

    /**
     * Completing it is not. A future booking marked COMPLETED matched neither the
     * "upcoming" nor the "completed" filter, so it disappeared from the customer's app
     * entirely — paid for, and visible nowhere they could look.
     */
    const completed = await request.post(`${API}/admin/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'COMPLETED' },
    });
    expect(completed.status(), 'completing a future booking should be refused').toBe(422);
    expect((await completed.json()).detail).toMatch(/has not started/i);
  });

  test('TC-209 a served booking stays visible to the customer', async ({ request }) => {
    const { bookingId } = await book(request, 6);
    const token = await adminToken(request);

    await request.post(`${API}/admin/bookings/${bookingId}/mark-paid`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { method: 'CASH' },
    });
    await request.post(`${API}/admin/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'CHECKED_IN' },
    });

    // Checked in and still to come: it belongs in "upcoming", and must be in exactly one
    // list rather than falling between them.
    const upcoming = await (
      await request.get(`${API}/bookings?status=upcoming`, {
        headers: { Authorization: `Bearer ${customer!.accessToken}` },
      })
    ).json();

    const ids = (upcoming.data as Array<{ id: string }>).map((b) => b.id);
    expect(ids, 'a checked-in future booking belongs under upcoming').toContain(bookingId);
  });
});
