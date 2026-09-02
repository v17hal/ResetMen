import { test as base, type APIRequestContext } from '@playwright/test';

import { API, type Customer, createCustomer, deleteCustomer, setPhone } from './support';

/**
 * Customers that live for the whole worker, not for one test.
 *
 * The first two versions of this suite made a fresh Firebase account inside every test.
 * Twenty-six accounts in a few minutes from one address is exactly what `/auth/firebase`'s
 * rate limit is for, so it started refusing and half the suite failed reporting a fault it
 * had caused itself. A rate limiter doing its job is not a finding, twice over.
 *
 * Two accounts per worker cover everything:
 *
 *   `guest`  — signed in, no phone number. For the tests about being asked for one.
 *   `booker` — signed in with a number. For everything that books.
 *
 * `booker` has its bookings cleared before each test rather than being thrown away, so a
 * test that expects an empty list gets one without another sign-up.
 */

async function cancelEverything(
  request: APIRequestContext,
  customer: Customer,
): Promise<void> {
  const res = await request.get(`${API}/bookings?status=upcoming`, {
    headers: { Authorization: `Bearer ${customer.accessToken}` },
  });
  if (!res.ok()) return;

  const { data } = (await res.json()) as { data: { id: string }[] };

  for (const booking of data) {
    await request
      .post(`${API}/bookings/${booking.id}/cancel`, {
        headers: { Authorization: `Bearer ${customer.accessToken}` },
        data: { reason: 'QA cleanup' },
      })
      .catch(() => undefined);
  }
}

export const test = base.extend<
  { booker: Customer },
  { guestAccount: Customer; bookerAccount: Customer }
>({
  guestAccount: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext();
      const customer = await createCustomer(request);

      await use(customer);

      await deleteCustomer(request, customer);
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  bookerAccount: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext();
      const customer = await createCustomer(request);
      await setPhone(request, customer);

      await use(customer);

      await cancelEverything(request, customer);
      await deleteCustomer(request, customer);
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  /**
   * The booking customer, with a clean slate.
   *
   * Cleared before each test rather than after, so a test that fails halfway still leaves
   * the next one something predictable to work with.
   */
  booker: async ({ bookerAccount, request }, use) => {
    await cancelEverything(request, bookerAccount);
    await use(bookerAccount);
  },
});

export { expect } from '@playwright/test';
