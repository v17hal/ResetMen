import { expect, test } from '@playwright/test';

import { ADMIN, expectDialogFitsViewport } from './support';

/**
 * Does the assertion still fail when the dialog really is off-screen?
 *
 * Throwaway. \`expectDialogFitsViewport\` was rewritten to poll rather than measure once,
 * because measuring during the sheet's entry animation reported an overflow that was not
 * real. A polling assertion that waits for a value to come good is one bad line away from
 * waiting for anything at all, and it would then pass on the very fault it exists to catch.
 *
 * So: push the dialog off the bottom on purpose and check the helper objects.
 */
test.use({ storageState: 'e2e/.auth/admin.json' });

test('the viewport assertion fails on a dialog that is genuinely off-screen', async ({ page }) => {
  await page.goto(`${ADMIN}/products`);
  await page.getByRole('button', { name: /add product/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  /**
   * Put the top edge on the bottom of the window, whichever variant this is.
   *
   * The first version of this shifted the box with \`margin-top\`, which does nothing to the
   * phone layout: a bottom sheet is pinned by \`bottom: 0\`, so it stayed exactly where it
   * was, the assertion rightly passed, and the self-check failed for saying it should not
   * have. Overriding the offsets themselves works on a margin-centred box and a pinned
   * sheet alike.
   */
  await page.getByRole('dialog').evaluate((node) => {
    const style = (node as HTMLElement).style;
    style.setProperty('top', '100vh', 'important');
    style.setProperty('bottom', 'auto', 'important');
    style.setProperty('margin', '0', 'important');
  });

  let failed = false;
  try {
    await expectDialogFitsViewport(page);
  } catch {
    failed = true;
  }

  expect(failed, 'the assertion passed a dialog hanging off the bottom — it is vacuous').toBe(
    true,
  );
});
