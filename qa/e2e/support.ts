import { expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Shared machinery for the suite.
 *
 * Two rules hold everything here together. Every test creates its own customer, so no test
 * can be broken by another one's leftovers or by the order they happen to run in. And
 * everything created is removed at the end, because this runs against production and a
 * suite that litters a live store is worse than no suite.
 */

export const API = process.env.API_URL ?? 'https://api.resetmen.in/api/v1';
export const WEB = process.env.WEB_URL ?? 'https://resetmen.in';
export const ADMIN = process.env.ADMIN_URL ?? 'https://admin.resetmen.in';

/** Public by design — it ships in every client and is restricted by authorised domain. */
const FIREBASE_KEY = 'AIzaSyAtZ3_K6iOvW7I0vxiRRGrKRooT73sMjDA';

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@resetmen.in';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Reset@123';

export interface Customer {
  email: string;
  password: string;
  /** Unique per run: `User.phone` is unique, so a fixed number collides with the last run. */
  phone: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

let counter = 0;

/** A brand-new customer, signed up through Firebase exactly as the app does. */
export async function createCustomer(request: APIRequestContext): Promise<Customer> {
  counter += 1;
  const stamp = `${Date.now()}${counter}`.slice(-9);
  const email = `qa-${stamp}@resetmen.in`;
  const password = 'QaSuite-Pw-2026';
  const phone = `+919${stamp}`;

  const signUp = await request.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_KEY}`,
    { data: { email, password, returnSecureToken: true } },
  );
  expect(signUp.ok(), 'Firebase sign-up should succeed').toBeTruthy();
  const { idToken } = (await signUp.json()) as { idToken: string };

  const exchange = await request.post(`${API}/auth/firebase`, { data: { idToken } });
  expect(exchange.ok(), 'the API should exchange a Firebase token').toBeTruthy();
  const { accessToken, refreshToken } = (await exchange.json()) as {
    accessToken: string;
    refreshToken: string;
  };

  return { email, password, phone, idToken, accessToken, refreshToken };
}

export async function setPhone(
  request: APIRequestContext,
  customer: Customer,
  name = 'QA Customer',
): Promise<void> {
  const res = await request.patch(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${customer.accessToken}` },
    data: { phone: customer.phone, name },
  });
  expect(res.ok(), 'saving a valid phone number should succeed').toBeTruthy();
}

/**
 * Removes the customer and everything they made. Safe to call twice.
 *
 * The bookings are cancelled first, and that is not belt and braces. This used to delete
 * only the account, and a deleted account's bookings stayed CONFIRMED and holding stations
 * — so every run of this suite left a handful of slots blocked on a live store, and after
 * a day of runs there were thirty-seven of them against one real booking. The suite claimed
 * to clean up after itself and did not.
 *
 * The API now releases them on deletion too, so this is the second of two locks on the same
 * door. It stays because a suite that runs against production should not depend on the
 * thing it is testing to tidy up after it.
 */
export async function deleteCustomer(
  request: APIRequestContext,
  customer: Customer,
): Promise<void> {
  const upcoming = await request
    .get(`${API}/bookings?status=upcoming`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
    })
    .catch(() => null);

  if (upcoming !== null && upcoming.ok()) {
    const { data } = (await upcoming.json()) as { data: { id: string }[] };
    for (const booking of data) {
      await request
        .post(`${API}/bookings/${booking.id}/cancel`, {
          headers: { Authorization: `Bearer ${customer.accessToken}` },
          data: { reason: 'QA cleanup' },
        })
        .catch(() => undefined);
    }
  }

  await request
    .delete(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${customer.accessToken}` },
    })
    .catch(() => undefined);

  await request
    .post(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE_KEY}`, {
      data: { idToken: customer.idToken },
    })
    .catch(() => undefined);
}

export async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/admin/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), 'admin sign-in should succeed').toBeTruthy();
  const { accessToken } = (await res.json()) as { accessToken: string };
  return accessToken;
}

/**
 * The first upcoming day the store is actually open and has room.
 *
 * A fixed offset lands on a Monday one week in five, the store is shut, and every booking
 * assertion fails at once for a reason that has nothing to do with the software.
 */
export async function firstOpenDay(
  request: APIRequestContext,
  serviceId: string,
): Promise<{ date: string; slots: { startsAt: string; stationsAvailable: number }[] }> {
  for (let offset = 1; offset <= 7; offset += 1) {
    const date = isoDate(offset);
    const res = await request.get(
      `${API}/availability/slots?serviceId=${serviceId}&date=${date}`,
    );
    if (!res.ok()) continue;

    const body = (await res.json()) as {
      slots: { startsAt: string; stationsAvailable: number }[];
    };
    if (body.slots.length > 20) return { date, slots: body.slots };
  }
  throw new Error('No open day with free slots in the next week.');
}

export function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA');
}

export async function catalogue(request: APIRequestContext): Promise<{
  services: { id: string; name: string; slug: string; pricePaise: number }[];
}> {
  const res = await request.get(`${API}/catalog/home`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as {
    services: { id: string; name: string; slug: string; pricePaise: number }[];
  };
}

/**
 * Signs a customer in inside the browser.
 *
 * Google's popup cannot be driven — it is Google's page, on Google's domain, and automating
 * a real sign-in is both fragile and against their terms. The app keeps its session in the
 * same token store either way, so seeding it puts the browser in exactly the state a signed-
 * in customer is in, without pretending to test Google's screen.
 *
 * What that does *not* cover is the popup itself, which is called out in the report rather
 * than quietly counted as passing.
 */
export async function signIn(page: Page, customer: Customer): Promise<void> {
  // `reset.web.auth`, holding the pair as JSON — see browserTokenStore in @reset/api-client.
  // Writing the wrong key or the wrong shape fails silently as "not signed in", so this is
  // asserted below rather than trusted.
  await page.addInitScript(
    ([access, refresh]) => {
      try {
        window.localStorage.setItem(
          'reset.web.auth',
          JSON.stringify({ accessToken: access, refreshToken: refresh }),
        );
      } catch {
        // Private mode. The test that needs a session will fail loudly and correctly.
      }
    },
    [customer.accessToken, customer.refreshToken],
  );
}

/** Signs in and proves it took, so a broken seed never reads as a broken feature. */
export async function signInAndVerify(page: Page, customer: Customer): Promise<void> {
  await signIn(page, customer);
  await page.goto(`${WEB}/account`);
  await expect(
    page.getByText(customer.email, { exact: false }).first(),
    'the seeded session should put the customer on their own account page',
  ).toBeVisible({ timeout: 15_000 });
}

/** Fails the test on any console error or uncaught exception — a blank screen has a cause. */
export function watchForClientErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));

  return errors;
}

/** No part of a page should scroll sideways on a phone. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scroll: doc.scrollWidth, client: doc.clientWidth };
  });

  expect(
    overflow.scroll,
    `page scrolls sideways: content ${overflow.scroll}px in a ${overflow.client}px viewport`,
  ).toBeLessThanOrEqual(overflow.client + 1);
}

/**
 * A dialog has to be inside the window it opened in.
 *
 * Worth asserting rather than eyeballing. Centring a fixed box with `top-1/2 left-1/2` and
 * a `-translate-1/2` breaks silently the moment anything else sets `transform` on the same
 * element — an entry animation, for instance — because transform is one property and the
 * last value wins outright. The box then sits with its top-left corner at the middle of the
 * screen and its footer somewhere below the fold, and it still looks like a dialog in a
 * screenshot of the top half.
 *
 * The measurement is what catches it: every edge inside the viewport, and the footer
 * buttons actually on screen.
 */
export async function expectDialogFitsViewport(page: Page): Promise<void> {
  const box = page.getByRole('dialog');
  await expect(box).toBeVisible();

  const rect = await box.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      left: Math.round(r.left),
      bottom: Math.round(r.bottom),
      right: Math.round(r.right),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });

  // One pixel of slack for sub-pixel rounding, and no more.
  expect(rect.top, `dialog starts ${-rect.top}px above the window`).toBeGreaterThanOrEqual(-1);
  expect(rect.left, `dialog starts ${-rect.left}px left of the window`).toBeGreaterThanOrEqual(-1);
  expect(
    rect.bottom,
    `dialog runs ${rect.bottom - rect.vh}px past the bottom of a ${rect.vh}px window — ` +
      'its footer is unreachable',
  ).toBeLessThanOrEqual(rect.vh + 1);
  expect(
    rect.right,
    `dialog runs ${rect.right - rect.vw}px past the right of a ${rect.vw}px window`,
  ).toBeLessThanOrEqual(rect.vw + 1);
}

/** Anything tappable should meet the 44px target the design tokens promise. */
export async function expectTouchTargets(page: Page, selector: string): Promise<void> {
  const small = await page.locator(selector).evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { text: (node.textContent ?? '').trim().slice(0, 30), h: Math.round(rect.height) };
      })
      .filter((item) => item.h > 0 && item.h < 44),
  );

  expect(small, `these targets are under 44px: ${JSON.stringify(small)}`).toEqual([]);
}
