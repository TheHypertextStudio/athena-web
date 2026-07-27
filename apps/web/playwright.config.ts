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
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // Retry in CI so a transient timing race (e.g. an async auto-scroll landing mid-assertion) fails
  // the whole suite only when it reproduces, not on a single unlucky run.
  retries: process.env['CI'] ? 2 : 0,
  forbidOnly: !!process.env['CI'],
  // Single-worker (below) means whichever spec happens to run first pays Turbopack's on-demand
  // compile cost for every route/chunk it touches that nothing earlier in the run has warmed —
  // repeatedly measured at 100s+ in CI (composer-reset.spec.ts, mcp-connect.spec.ts,
  // mcp-session.spec.ts each independently hit this and needed `test.slow()` for the identical
  // reason). 120s left too little margin across the whole suite, not just those three files;
  // raised once, globally, rather than opting in file by file as each one gets unlucky.
  timeout: 180_000,
  expect: { timeout: TIMEOUTS.ui },
  reporter: 'list',
  use: {
    baseURL: ORIGIN,
    ignoreHTTPSErrors: true,
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
