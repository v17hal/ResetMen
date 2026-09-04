import { expect, test } from '@playwright/test';

import { WEB, type Customer, createCustomer, deleteCustomer, signIn } from './support';

/**
 * The account form, and the way it reports a mistake.
 *
 * A tester filled the email field with rubbish and pressed Save several times. Each attempt
 * added a permanent error notice — errors deliberately never auto-dismiss — and after four
 * presses the stack of them covered the fields being corrected. The form was reported as
 * unusable, which it was.
 */

let customer: Customer | undefined;

test.afterEach(async ({ request }) => {
  if (customer !== undefined) {
    await deleteCustomer(request, customer);
    customer = undefined;
  }
});

test('TC-36 repeated failures do not bury the form in notices', async ({ page, request }) => {
  customer = await createCustomer(request);
  await signIn(page, customer);

  await page.goto(`${WEB}/account`);
  await expect(page.getByLabel(/^email$/i)).toBeVisible({ timeout: 20_000 });

  await page.getByLabel(/^email$/i).fill('not-an-email-at-all');

  // Four attempts, as the tester made.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByRole('button', { name: /^save$/i }).click();
    await page.waitForTimeout(400);
  }

  /**
   * One notice, not four.
   *
   * Repeating a message already on screen tells the reader nothing they cannot see, so the
   * existing one is kept rather than a fifth being stacked beneath it.
   */
  const notices = page.getByRole('alert').filter({ hasText: /email/i });
  const count = await notices.count();
  expect(count, `${count} identical notices are stacked up`).toBeLessThanOrEqual(1);

  // And the thing being corrected is still reachable underneath them.
  await expect(
    page.getByLabel(/^email$/i),
    'the field being corrected must not be covered',
  ).toBeInViewport();
  await expect(page.getByRole('button', { name: /^save$/i })).toBeInViewport();
});

test('TC-37 the message is a sentence, not a field dump', async ({ page, request }) => {
  customer = await createCustomer(request);
  await signIn(page, customer);

  await page.goto(`${WEB}/account`);
  await expect(page.getByLabel(/^email$/i)).toBeVisible({ timeout: 20_000 });

  await page.getByLabel(/^email$/i).fill('still-not-an-email');
  await page.getByRole('button', { name: /^save$/i }).click();

  const notice = page.getByRole('alert').filter({ hasText: /email/i }).first();
  await expect(notice).toBeVisible({ timeout: 15_000 });

  // It used to read `email: Invalid email` — a Zod issue printed the way a developer reads
  // one, shown to a customer, prefixed with a field name they never saw a label for.
  const text = (await notice.innerText()).trim();
  expect(text, 'should not be prefixed with the field path').not.toMatch(/^email:\s/i);
  expect(text[0], 'should start as a sentence does').toBe(text[0]?.toUpperCase());
});

test('TC-38 a real address with a short TLD is accepted', async ({ page, request }) => {
  customer = await createCustomer(request);
  await signIn(page, customer);

  await page.goto(`${WEB}/account`);
  await expect(page.getByLabel(/^email$/i)).toBeVisible({ timeout: 20_000 });

  /**
   * `.co` is a real top-level domain, and so are `.in`, `.io` and `.co.uk`.
   *
   * Reported as a defect on the grounds that only `.com` should be accepted. Requiring that
   * would reject most Indian business addresses, so this asserts the current behaviour is
   * correct and guards against somebody "fixing" it.
   */
  await page.getByLabel(/^email$/i).fill('someone@shop.co');
  await page.getByRole('button', { name: /^save$/i }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: /invalid|not look right/i }),
    'a .co address is valid and must not be refused',
  ).toHaveCount(0, { timeout: 10_000 });
});
