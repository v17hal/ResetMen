import { defineConfig, devices } from '@playwright/test';

/**
 * System integration and acceptance tests, driven through a real browser.
 *
 * Run against production by default, because that is what the client is testing and a
 * staging copy would prove something else. Everything the suite creates it cleans up, and
 * anything it cannot clean up it does not create.
 *
 *   pnpm --filter @reset/qa test                     # everything, both layouts
 *   pnpm --filter @reset/qa test --project=mobile    # phone layout only
 *   pnpm --filter @reset/qa test -g "TC-01"          # one case
 *
 * Video is on for every test, not just failures: the ask was a recording per test case,
 * named for what it checks. `qa/rename-videos.mjs` moves each one to
 * `qa/videos/<project>/TC-042 — what it checks.webm` once the run finishes.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './.artifacts',

  /**
   * One at a time.
   *
   * This machine has about two gigabytes free and a Chromium instance wants several hundred
   * megabytes; running four in parallel is how a suite starts failing for reasons that have
   * nothing to do with the software under test. It is slower and it is honest.
   */
  workers: 1,
  fullyParallel: false,

  // A retry hides a flake, and a flake on a booking flow is usually a real race. Failures
  // should be looked at, not smoothed over.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: './report', open: 'never' }],
    ['json', { outputFile: './report/results.json' }],
  ],

  use: {
    baseURL: process.env.WEB_URL ?? 'https://resetmen.in',
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    // Real network, real TLS. A certificate problem is a finding, not something to skip past.
    ignoreHTTPSErrors: false,
  },

  projects: [
    /**
     * Signs in as staff once; every admin test reuses the session.
     *
     * Signing in per test meant thirty logins from one address in a few minutes, the rate
     * limiter did exactly what it is for, and two thirds of the admin suite failed reporting
     * a fault that did not exist. It is also what staff actually do: sign in once, work all
     * day.
     */
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      dependencies: ['setup'],
    },
    {
      /**
       * The layout most customers will actually meet.
       *
       * Pixel 7 rather than a resized desktop window: it carries touch, a real device pixel
       * ratio and a mobile user agent, and layout bugs on phones hide behind all three.
       */
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      dependencies: ['setup'],
    },
  ],
});
