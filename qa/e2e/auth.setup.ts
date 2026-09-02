import { expect, test as setup } from '@playwright/test';

import { ADMIN, ADMIN_EMAIL, ADMIN_PASSWORD } from './support';

/**
 * Signs in as staff once, and saves the session for every admin test to reuse.
 *
 * The first version of this suite signed in inside each test. Thirty tests meant thirty
 * sign-ins from one address in a few minutes, which is exactly what the login rate limiter
 * exists to stop — so two thirds of the admin suite failed, reported a product fault, and
 * had none. A rate limit doing its job is not a finding.
 *
 * Signing in once is also what a person does: staff open the panel in the morning and stay
 * signed in all day. Testing thirty logins tested something nobody does.
 *
 * The sign-in itself is still covered — TC-41 and TC-42 exercise the wrong and the right
 * password directly, and they are the only tests that touch the form.
 */
setup('sign in as staff and save the session', async ({ page }) => {
  await page.goto(`${ADMIN}/login`);

  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(
    page.getByText(/Today|Timeline/i).first(),
    'staff sign-in should land on the panel',
  ).toBeVisible({ timeout: 30_000 });

  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});
