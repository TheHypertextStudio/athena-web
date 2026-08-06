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
  // Evidence capture, not regression tests: these drive the app to take screenshots for human
  // review and assert little or nothing, while accounting for two thirds of the suite's runtime.
  // Run them deliberately with `pnpm test:e2e:evidence`, which sets E2E_EVIDENCE=1.
  testIgnore:
    process.env['E2E_EVIDENCE'] === '1'
      ? []
      : ['**/*-shots.spec.ts', '**/verify-*.spec.ts', '**/*-evidence.spec.ts'],
  fullyParallel: false,
  workers: 1,
  // Retry in CI so a transient timing race (e.g. an async auto-scroll landing mid-assertion) fails
  // the whole suite only when it reproduces, not on a single unlucky run. One retry, not two:
  // every extra attempt is another full `timeout` added to the worst case, and a race that
  // survives two attempts is a bug report rather than a flake.
  retries: process.env['CI'] ? 1 : 0,
  forbidOnly: !!process.env['CI'],
  // The budget a test gets before it is called stuck, NOT a budget for compiling the app. Raising
  // it to absorb Turbopack's on-demand compile only converts a stall into a longer stall — every
  // extra second is spent by whichever test is unlucky, multiplied by the retries. A test that
  // genuinely needs more than this fails fast and loud, which is the more useful answer.
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
