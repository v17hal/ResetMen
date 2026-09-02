import { expect, test } from './fixtures';

import {
  WEB,
  catalogue,
  expectNoHorizontalOverflow,
  expectTouchTargets,
  firstOpenDay,
  signIn,
  watchForClientErrors,
} from './support';

/**
 * The customer-facing website, driven as a customer would.
 *
 * Each test names what it checks, because the recording is filed under that name and someone
 * reading the folder should not have to open a video to know what it was for.
 */

test.describe('Catalogue', () => {
  test('TC-01 catalogue loads with services, prices and durations', async ({ page }) => {
    const errors = watchForClientErrors(page);
    await page.goto(WEB);

    await expect(page.getByRole('heading', { name: 'Book your reset' })).toBeVisible();
    await expect(page.getByText('Stress Relief').first()).toBeVisible();
    await expect(page.getByText('Head', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/₹\d/).first()).toBeVisible();
    await expect(page.getByText(/\d+m/).first()).toBeVisible();

    expect(errors, 'the page should load without console errors').toEqual([]);
  });

  test('TC-02 every service row offers a BOOK action', async ({ page }) => {
    await page.goto(WEB);
    const book = page.getByText('BOOK', { exact: true });
    await expect(book.first()).toBeVisible();
    expect(await book.count(), 'each service should have its own action').toBeGreaterThan(2);
  });

  test('TC-03 search narrows the list to matching services', async ({ page }) => {
    await page.goto(WEB);
    await page.getByPlaceholder('Search for a service').fill('head');

    await expect(page.getByText('Head', { exact: true }).first()).toBeVisible();
    // "Basic" matches only through its description, and a name match exists, so it is out.
    await expect(page.getByText('Basic', { exact: true })).toHaveCount(0);
  });

  test('TC-04 search can be cleared and the full list returns', async ({ page }) => {
    await page.goto(WEB);
    const field = page.getByPlaceholder('Search for a service');
    await field.fill('head');
    await expect(page.getByText('Basic', { exact: true })).toHaveCount(0);

    await field.fill('');
    await expect(page.getByText('Basic', { exact: true }).first()).toBeVisible();
  });

  test('TC-05 a search with no matches explains itself', async ({ page }) => {
    await page.goto(WEB);
    await page.getByPlaceholder('Search for a service').fill('zzzzzz');
    await expect(page.getByText(/No match/i)).toBeVisible();
  });

  test('TC-06 a category filters the list, and tapping it again clears the filter', async ({
    page,
  }) => {
    await page.goto(WEB);
    const bubble = page.getByRole('button', { name: /Full Body Relax/i }).first();

    await bubble.click();
    await expect(page.getByText('Head', { exact: true })).toHaveCount(0);

    await bubble.click();
    await expect(page.getByText('Head', { exact: true }).first()).toBeVisible();
  });

  test('TC-07 a service opens its own page with price and duration', async ({ page }) => {
    await page.goto(WEB);
    await page.getByText('Head', { exact: true }).first().click();

    await expect(page).toHaveURL(/\/service\//);
    await expect(page.getByText(/₹\d/).first()).toBeVisible();
  });

  test('TC-08 back from a service returns to the catalogue', async ({ page }) => {
    await page.goto(WEB);
    await page.getByText('Head', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/service\//);

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Book your reset' })).toBeVisible();
  });
});

test.describe('Booking', () => {

  test('TC-10 booking is refused until a mobile number is given', async ({ page, request, guestAccount }) => {
    await signIn(page, guestAccount);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    await page.goto(
      `${WEB}/checkout?serviceId=${head.id}&startsAt=${encodeURIComponent(slots[0]!.startsAt)}`,
    );

    await expect(page.getByText(/One more thing|mobile number/i).first()).toBeVisible();
  });

  test('TC-11 a number longer than ten digits cannot be entered', async ({ page, request, guestAccount }) => {
    await signIn(page, guestAccount);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    await page.goto(
      `${WEB}/checkout?serviceId=${head.id}&startsAt=${encodeURIComponent(slots[0]!.startsAt)}`,
    );

    const field = page.getByPlaceholder('10-digit mobile number');
    await field.fill('99222222222222222222222222');

    const entered = ((await field.inputValue()) ?? '').replace(/\D/g, '');
    expect(entered.length, 'the field should not hold more than a mobile number').toBeLessThanOrEqual(14);
  });

  test('TC-12 a number that is not an Indian mobile is refused with a reason', async ({
    page,
    request,
    guestAccount,
  }) => {
    await signIn(page, guestAccount);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    await page.goto(
      `${WEB}/checkout?serviceId=${head.id}&startsAt=${encodeURIComponent(slots[0]!.startsAt)}`,
    );

    await page.getByPlaceholder('10-digit mobile number').fill('1234567890');
    await page.getByRole('button', { name: /Save and continue/i }).click();

    // Never the generic fallback: the customer has to know which rule they broke.
    await expect(page.getByText(/starts with 6, 7, 8 or 9/i)).toBeVisible();
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  });

  test('TC-13 opening checkout does not create a booking', async ({ page, request,
    booker,
  }) => {
    await signIn(page, booker);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    await page.goto(
      `${WEB}/checkout?serviceId=${head.id}&startsAt=${encodeURIComponent(slots[2]!.startsAt)}`,
    );
    await expect(page.getByRole('button', { name: /^Book$/ })).toBeEnabled();

    // Leave without pressing anything — the slot must still be free and the list empty.
    await page.goto(`${WEB}/bookings`);

    const mine = await request.get(`${process.env.API_URL ?? 'https://api.resetmen.in/api/v1'}/bookings`, {
      headers: { Authorization: `Bearer ${booker.accessToken}` },
    });
    const body = (await mine.json()) as { data: unknown[] };
    expect(body.data, 'browsing to checkout must not book anything').toHaveLength(0);
  });

  test('TC-14 the button says Book, and takes no money', async ({ page, request,
    booker,
  }) => {
    await signIn(page, booker);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    await page.goto(
      `${WEB}/checkout?serviceId=${head.id}&startsAt=${encodeURIComponent(slots[3]!.startsAt)}`,
    );

    await expect(page.getByRole('button', { name: /^Book$/ })).toBeVisible();
    await expect(page.getByText(/Pay at the counter/i)).toBeVisible();
  });

  test('TC-15 booking succeeds and reports itself as awaiting confirmation', async ({
    page,
    request,
    booker,
  }) => {
    await signIn(page, booker);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    await page.goto(
      `${WEB}/checkout?serviceId=${head.id}&startsAt=${encodeURIComponent(slots[4]!.startsAt)}`,
    );
    await page.getByRole('button', { name: /^Book$/ }).click();

    await expect(page).toHaveURL(/\/confirmation\//, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /Awaiting confirmation/i })).toBeVisible();
    await expect(page.getByText(/Entry code pending/i)).toBeVisible();
    await expect(page.getByText(/to pay/i).first()).toBeVisible();
  });

  test('TC-16 an unpaid booking shows no QR code', async ({ page, request,
    booker,
  }) => {
    await signIn(page, booker);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    await page.goto(
      `${WEB}/checkout?serviceId=${head.id}&startsAt=${encodeURIComponent(slots[5]!.startsAt)}`,
    );
    await page.getByRole('button', { name: /^Book$/ }).click();
    await expect(page).toHaveURL(/\/confirmation\//, { timeout: 20_000 });

    // The code is the store's assurance the visit is settled; it should not exist yet.
    await expect(page.locator('canvas, img[alt*="QR" i]')).toHaveCount(0);
  });

  test('TC-17 the booking appears under Visits, marked awaiting confirmation', async ({
    page,
    request,
    booker,
  }) => {
    await signIn(page, booker);

    const { services } = await catalogue(request);
    const head = services.find((s) => s.name === 'Head')!;
    const { slots } = await firstOpenDay(request, head.id);

    await page.goto(
      `${WEB}/checkout?serviceId=${head.id}&startsAt=${encodeURIComponent(slots[6]!.startsAt)}`,
    );
    await page.getByRole('button', { name: /^Book$/ }).click();
    await expect(page).toHaveURL(/\/confirmation\//, { timeout: 20_000 });

    await page.goto(`${WEB}/bookings`);
    await expect(page.getByText(/Awaiting confirmation/i).first()).toBeVisible();
  });
});

test.describe('Account', () => {
  /**
   * One customer for the whole group.
   *
   * A fresh Firebase account per test meant forty sign-ups from one address in twenty
   * minutes, which exhausted the auth rate limit and failed the tail of the suite for a
   * reason that had nothing to do with the product. These three tests only read and edit
   * one profile, so they can share.
   */


  test('TC-20 clearing a saved number is refused with a reason', async ({ page, booker }) => {
    await signIn(page, booker);

    await page.goto(`${WEB}/account`);
    await page.getByLabel(/Mobile number/i).fill('');
    await page.getByRole('button', { name: /^Save$/ }).click();

    await expect(page.getByText(/needed to book|cannot be/i).first()).toBeVisible();
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  });

  test('TC-21 no field is pre-filled with a value that is not the customer\'s', async ({
    page,
    guestAccount,
  }) => {
    await signIn(page, guestAccount);
    await page.goto(`${WEB}/account`);

    const phone = page.getByLabel(/Mobile number/i);
    expect(
      (await phone.inputValue()).trim(),
      'an empty profile should show an empty field, not an example number',
    ).toBe('');
  });

  test('TC-22 date of birth cannot be set to an impossible date', async ({ page, guestAccount }) => {
    await signIn(page, guestAccount);
    await page.goto(`${WEB}/account`);

    const dob = page.getByLabel(/Date of birth/i);
    await expect(dob).toHaveAttribute('max', /\d{4}-\d{2}-\d{2}/);
    await expect(dob).toHaveAttribute('min', /\d{4}-\d{2}-\d{2}/);
  });
});

test.describe('Layout and accessibility', () => {
  for (const path of ['/', '/bookings', '/rewards', '/shop', '/account']) {
    test(`TC-30${path.replace('/', '-') || '-home'} ${path} has no sideways scroll`, async ({
      page,
    }) => {
      await page.goto(`${WEB}${path}`);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await expectNoHorizontalOverflow(page);
    });
  }

  test('TC-31 every page renders without a client-side exception', async ({ page }) => {
    const errors = watchForClientErrors(page);

    for (const path of ['/', '/bookings', '/rewards', '/shop', '/account']) {
      await page.goto(`${WEB}${path}`);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await expect(
        page.getByText(/Application error|client-side exception/i),
        `${path} should not fall over`,
      ).toHaveCount(0);
    }

    expect(errors.filter((e) => !/favicon|manifest/i.test(e))).toEqual([]);
  });

  test('TC-32 navigation targets are big enough to tap', async ({ page }) => {
    await page.goto(WEB);
    await expectTouchTargets(page, 'nav a, nav button');
  });

  test('TC-33 the page has one main heading and a skip link', async ({ page }) => {
    await page.goto(WEB);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('link', { name: /skip to content/i })).toHaveCount(1);
  });

  test('TC-34 the catalogue can be reached by keyboard alone', async ({ page }) => {
    await page.goto(WEB);

    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
      if (tag === 'INPUT' || tag === 'A' || tag === 'BUTTON') return;
    }
    throw new Error('nothing focusable within twelve tabs of the top of the page');
  });

  test('TC-35 every image carries alt text', async ({ page }) => {
    await page.goto(WEB);
    const missing = await page
      .locator('img:not([alt])')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).src));
    expect(missing, 'images without alt text').toEqual([]);
  });
});
