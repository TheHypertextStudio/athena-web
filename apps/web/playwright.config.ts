import { defineConfig, devices } from '@playwright/test';

import { ORIGIN, TIMEOUTS } from './e2e/helpers/constants';

/**
 * Playwright e2e configuration.
 *
 * The specs drive the **running dev stack** (`pnpm dev`) over its self-signed HTTPS origin, sign
 * up throwaway accounts (the embedded pglite dev DB is disposable), and exercise real passwordless
 * passkey ceremonies via a CDP virtual authenticator (see `e2e/helpers/fixtures.ts`). Run the whole
 * suite with `pnpm test:e2e`; target a different origin with `APP_URL=…`. The origin/RP id and the
 * named timeouts come from `e2e/helpers/constants.ts` (one source of truth).
 *
 * Serial single-worker on purpose: every spec mutates the one shared embedded dev database.
 */
/**
 * The default frame every spec runs in.
 *
 * @remarks
 * 1440 is the shell's rail-docking width (`RAIL_DOCK_QUERY` in `@docket/ui`'s `AppShell`), so this
 * is the layout where the right rail is a panel *beside* `<main>` rather than an overlay — the
 * arrangement specs assume whenever they reach for the Tasks or Agenda panel, and the width the
 * design review shoots. Specs that need a narrower frame override it locally with
 * `test.use({ viewport })`.
 */
const VIEWPORT = { width: 1440, height: 900 } as const;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // Retry in CI so a transient timing race (e.g. an async auto-scroll landing mid-assertion) fails
  // the whole suite only when it reproduces, not on a single unlucky run. One retry, not two:
  // every extra attempt is another full `timeout` added to the worst case, and a race that
  // survives two attempts is a bug report rather than a flake.
  retries: process.env['CI'] ? 1 : 0,
  forbidOnly: !!process.env['CI'],
  // The budget a test gets before it is called stuck, NOT a budget for compiling the app.
  //
  // This was 180s with nine specs calling `test.slow()` on top, which triples it. A flaky test
  // therefore burned 540s per attempt: on the last green run one offline-sync test failed at
  // exactly 9.0m and then passed on retry in 55s, which was the whole difference between that
  // shard at 12.6m and its siblings at 4-7m. The suite is not slow — its tail is.
  //
  // Those budgets all existed to absorb Turbopack's on-demand compile, because the e2e job runs
  // against `next dev`. Until that job runs a production build, a test that legitimately needs
  // the compile budget will fail here rather than stall the shard, which is the trade we want:
  // a fast, loud failure beats a nine-minute wait for the same information.
  timeout: 120_000,
  expect: { timeout: TIMEOUTS.ui },
  reporter: 'list',
  use: {
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    headless: true,
    viewport: VIEWPORT,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // `devices['Desktop Chrome']` carries its own 1280x720 viewport, and a project-level `use` wins
  // over the top-level one — so the viewport has to be re-applied *after* the device spread or the
  // setting above is silently discarded.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } }],
});
