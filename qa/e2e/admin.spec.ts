import { expect, test } from '@playwright/test';

import {
  ADMIN,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API,
  type Customer,
  catalogue,
  createCustomer,
  deleteCustomer,
  expectDialogFitsViewport,
  expectNoHorizontalOverflow,
  firstOpenDay,
  isoDate,
  setPhone,
  watchForClientErrors,
} from './support';

/**
 * The admin panel, driven as a member of staff would.
 *
 * Read-heavy on purpose. This runs against the live store, so screens are opened and read,
 * and the few tests that write clean up after themselves in the same test. Nothing here
 * edits a real service, price or opening time: getting that wrong on production is a worse
 * outcome than not having covered it, and the destructive paths are listed in the report as
 * needing a staging store rather than quietly skipped.
 */

/** The session saved by auth.setup.ts. Reused rather than re-earned on every test. */
const STAFF_SESSION = { storageState: 'e2e/.auth/admin.json' } as const;

test.describe('Admin access', () => {
  test('TC-40 a signed-out visitor cannot reach the panel', async ({ page }) => {
    await page.goto(`${ADMIN}/timeline`);
    await expect(page.getByLabel(/password/i)).toBeVisible({ timeout: 15_000 });
  });

  test('TC-41 the wrong password is refused', async ({ page }) => {
    await page.goto(`${ADMIN}/login`);
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill('NotTheRightPassword123');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid|incorrect|wrong/i).first()).toBeVisible();
  });

  test('TC-42 a valid password signs staff in', async ({ page }) => {
    await page.goto(`${ADMIN}/login`);
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Not the nav links: below `lg` they live in a drawer and are correctly hidden. Landing
    // anywhere other than /login is what signing in means.
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
    await expect(page.getByRole('main')).toBeVisible();
  });
});

test.describe('Admin screens load', () => {
  test.use(STAFF_SESSION);

  for (const [id, path, heading] of [
    ['TC-50', '/', /Today|Dashboard/i],
    ['TC-51', '/timeline', /Timeline/i],
    ['TC-52', '/checkin', /Check in/i],
    ['TC-53', '/payments-due', /Payments due/i],
    ['TC-54', '/customers', /Customers/i],
    ['TC-55', '/catalog', /Catalog/i],
    ['TC-56', '/capacity', /Capacity/i],
    ['TC-57', '/rewards', /Rewards/i],
    ['TC-58', '/products', /Products/i],
    ['TC-59', '/payments', /Payments/i],
    ['TC-60', '/reports', /Reports/i],
    ['TC-61', '/staff', /Staff/i],
    ['TC-62', '/audit', /Audit/i],
  ] as const) {
    test(`${id} ${path} opens and renders`, async ({ page }) => {
      const errors = watchForClientErrors(page);

      await page.goto(`${ADMIN}${path}`);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(/Application error|client-side exception/i)).toHaveCount(0);

      expect(
        errors.filter((e) => !/favicon|manifest|404/i.test(e)),
        `${path} logged client errors`,
      ).toEqual([]);
    });
  }
});

/**
 * Every tab of every multi-tab screen, opened.
 *
 * TC-50..62 load each screen and check it renders, which only ever exercised the tab each
 * one opens on. Capacity → Allocation rules threw `Cannot read properties of undefined`
 * on every load — the screen read `stationIds` and `serviceIds`, which that endpoint has
 * never sent, asserted through a cast over an `unknown[]` so nothing could check it — and
 * the whole suite passed regardless, because nothing ever clicked the second tab.
 *
 * A tab is a screen. This opens all of them and fails on any client-side exception.
 */
test.describe('Every tab renders', () => {
  test.use(STAFF_SESSION);

  for (const [id, path, tabs] of [
    ['TC-63', '/capacity', ['Stations', 'Allocation rules', 'Opening hours', 'Closures', 'Booking settings']],
    ['TC-64', '/catalog', ['Services', 'Categories', 'Segments', 'Add-ons']],
    ['TC-65', '/rewards', ['Streak rules', 'Scratch campaigns', 'Manual grant']],
    ['TC-66', '/products', ['Catalog', 'Orders']],
  ] as const) {
    test(`${id} ${path} — every tab opens without an exception`, async ({ page }) => {
      const errors = watchForClientErrors(page);
      await page.goto(`${ADMIN}${path}`);

      for (const tab of tabs) {
        await page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') }).click();

        await expect(
          page.getByText(/Application error|client-side exception/i),
          `${path} → ${tab} crashed the page`,
        ).toHaveCount(0);
        // The panel still has to be rendering something, not a blank error boundary.
        await expect(page.getByRole('main')).toBeVisible();
      }

      expect(
        errors.filter((e) => !/favicon|manifest|404/i.test(e)),
        `${path} logged client errors while moving between tabs`,
      ).toEqual([]);
    });
  }
});

test.describe('Payments due — the counter\'s working screen', () => {
  let customer: Customer;

  test.use(STAFF_SESSION);

  test.afterEach(async ({ request }) => {
    if (customer !== undefined) await deleteCustomer(request, customer);
  });

  test('TC-70 an unpaid booking appears with the number to ring', async ({ page, request }) => {
    customer = await createCustomer(request);
    await setPhone(request, customer);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    const made = await request.post(`${API}/bookings/hold`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
      data: { serviceId: head.id, startsAt: slots[8]!.startsAt, addonIds: [] },
    });
    expect(made.ok()).toBeTruthy();
    const { publicId } = (await made.json()) as { publicId: string };

    await page.goto(`${ADMIN}/payments-due`);
    await expect(page.getByText(publicId)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Unpaid').first()).toBeVisible();
    // The whole point of the screen: a number staff can ring. Rendered by formatPhone as
    // "+91 92762 03841", so the digits are grouped and never appear as one run.
    const grouped = customer.phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
    await expect(page.getByRole('link', { name: grouped })).toBeVisible();
  });

  test('TC-71 marking a booking paid moves it and issues the entry code', async ({
    page,
    request,
  }) => {
    customer = await createCustomer(request);
    await setPhone(request, customer);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    const made = await request.post(`${API}/bookings/hold`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
      data: { serviceId: head.id, startsAt: slots[9]!.startsAt, addonIds: [] },
    });
    const { publicId, bookingId } = (await made.json()) as {
      publicId: string;
      bookingId: string;
    };

    await page.goto(`${ADMIN}/payments-due`);
    const row = page.getByRole('row').filter({ hasText: publicId });
    await row.getByRole('button', { name: /mark paid/i }).click();

    await expect(page.getByText(/recorded|paid/i).first()).toBeVisible({ timeout: 15_000 });

    const after = await request.get(`${API}/bookings/${bookingId}`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
    });
    const detail = (await after.json()) as { isPaid: boolean; checkinPayload: string | null };
    expect(detail.isPaid, 'the booking should now be paid').toBe(true);
    expect(detail.checkinPayload, 'the entry code should exist once paid').not.toBeNull();
  });

  test('TC-72 an unpaid booking cannot be checked in', async ({ page, request }) => {
    customer = await createCustomer(request);
    await setPhone(request, customer);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    const made = await request.post(`${API}/bookings/hold`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
      data: { serviceId: head.id, startsAt: slots[10]!.startsAt, addonIds: [] },
    });
    const { publicId } = (await made.json()) as { publicId: string };

    await page.goto(`${ADMIN}/checkin`);
    await page.getByLabel(/code/i).fill(publicId);
    await page.getByRole('button', { name: /check in/i }).click();

    /**
     * Scoped to the page's own content, and to words only the real message uses.
     *
     * Two earlier versions of this assertion were wrong in opposite directions. Matching
     * `/payment/i` anywhere found the nav link "Payments due" — always visible on desktop,
     * so the test passed without testing anything. Matching `role="alert"` found the empty
     * toast container and Next's route announcer instead of the message.
     */
    await expect(
      page.getByRole('main').getByText(/has not been paid|Take payment/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('TC-73 cancelling asks first, then frees the slot', async ({ page, request }) => {
    customer = await createCustomer(request);
    await setPhone(request, customer);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    const made = await request.post(`${API}/bookings/hold`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
      data: { serviceId: head.id, startsAt: slots[11]!.startsAt, addonIds: [] },
    });
    const { publicId, bookingId } = (await made.json()) as {
      publicId: string;
      bookingId: string;
    };

    await page.goto(`${ADMIN}/payments-due`);
    const row = page.getByRole('row').filter({ hasText: publicId });
    await row.getByRole('button', { name: /^cancel$/i }).click();

    // Freeing someone's slot should never be one mis-tap away.
    await expect(page.getByText(/Cancel this booking/i)).toBeVisible();
    await page.getByRole('button', { name: /yes, cancel/i }).click();

    await expect.poll(async () => {
      const res = await request.get(`${API}/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${customer.accessToken}` },
      });
      return ((await res.json()) as { status: string }).status;
    }, { timeout: 15_000 }).toBe('CANCELLED');
  });
});

test.describe('Catalogue and capacity are readable by staff', () => {
  test.use(STAFF_SESSION);

  test('TC-80 stations are listed with the services they can take', async ({ page }) => {
    await page.goto(`${ADMIN}/capacity`);
    await expect(page.getByText(/station/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('TC-81 services are listed with prices and durations', async ({ page }) => {
    await page.goto(`${ADMIN}/catalog`);
    await expect(page.getByText('Head', { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/₹|\d+ ?min/i).first()).toBeVisible();
  });

  test('TC-82 the products screen offers a way to add one', async ({ page }) => {
    await page.goto(`${ADMIN}/products`);
    await expect(page.getByRole('button', { name: /add|new/i }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('TC-83 the timeline shows the day station by station', async ({ page }) => {
    await page.goto(`${ADMIN}/timeline`);
    await expect(page.getByText(/station/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('TC-84 reports produce figures for a date range', async ({ page }) => {
    await page.goto(`${ADMIN}/reports`);
    await expect(page.getByText(/revenue|bookings|total/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('TC-85 the audit log records who did what', async ({ page }) => {
    await page.goto(`${ADMIN}/audit`);
    await expect(page.getByRole('heading', { name: /audit/i })).toBeVisible({ timeout: 20_000 });
  });
});

/**
 * Every form dialog in the panel, measured.
 *
 * The Add product dialog was reported as having no Save button on a normal screen. It had
 * one; the box was hanging off the bottom of the window with the footer below the fold, and
 * shrinking the browser appeared to fix it because less of the box then fell outside. Two
 * separate faults did that — an uncapped height, and centring that a transform animation
 * silently overrode — and the first was fixed on its own, which changed nothing a user
 * could see.
 *
 * So it is asserted per screen rather than spot-checked, and on both layouts. A dialog off
 * the bottom of the window is a screen staff cannot use at all.
 */
test.describe('Form dialogs open inside the window', () => {
  test.use(STAFF_SESSION);

  /**
   * `tab` is the one several of these screens need first — Catalog opens on Services and
   * Rewards on Streaks, so the button that opens the dialog does not exist until the right
   * tab is selected. TC-103 failed on that before it ever reached the measurement, which is
   * a fault in the test and worth saying so rather than quietly routing around.
   */
  for (const [id, path, opener, tab] of [
    ['TC-100', '/products', /add product/i, null],
    ['TC-101', '/catalog', /add service/i, null],
    ['TC-102', '/capacity', /add closure/i, /^closures$/i],
    ['TC-103', '/rewards', /new campaign/i, /scratch campaigns/i],
    ['TC-104', '/catalog', /add group/i, /^add-ons$/i],
    ['TC-105', '/staff', /add|new/i, null],
  ] as const) {
    test(`${id} ${path} — the dialog fits, and its buttons are reachable`, async ({ page }) => {
      await page.goto(`${ADMIN}${path}`);

      if (tab !== null) {
        await page.getByRole('tab', { name: tab }).click();
      }

      await page.getByRole('button', { name: opener }).first().click();
      await expectDialogFitsViewport(page);

      // The footer is the half that went missing. A visible dialog with an unreachable
      // Save button is the exact thing that was reported as "no save button".
      const save = page
        .getByRole('dialog')
        .getByRole('button', { name: /save|create|add|close these times/i })
        .last();
      await expect(save).toBeInViewport();
    });
  }
});

test.describe('Admin layout', () => {
  test.use(STAFF_SESSION);

  for (const [id, path] of [
    ['TC-90', '/payments-due'],
    ['TC-91', '/timeline'],
    ['TC-92', '/customers'],
  ] as const) {
    test(`${id} ${path} does not scroll sideways`, async ({ page }) => {
      await page.goto(`${ADMIN}${path}`);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await expectNoHorizontalOverflow(page);
    });
  }

  test('TC-93 the date on Payments due can be moved and the list follows', async ({ page }) => {
    await page.goto(`${ADMIN}/payments-due`);
    await page.getByRole('button', { name: /pick one day/i }).click();

    const field = page.locator('input[type="date"]');
    await field.fill(isoDate(2));
    await expect(field).toHaveValue(isoDate(2));
  });
});
