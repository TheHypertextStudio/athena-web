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
  forbidOnly: !!process.env['CI'],
  timeout: 120_000,
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
