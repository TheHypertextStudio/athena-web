/**
 * Small shared UI helpers: the app's inline error-alert assertion and the one screenshot convention.
 *
 * @remarks
 * The app has no toast system — failures render as a non-empty `role="alert"` banner, asserted the
 * same way in several specs ({@link expectAlert}). Screenshots standardize on `testInfo.attach`
 * ({@link attachShot}) so artifacts land in the Playwright report (`playwright show-report`) rather
 * than a bespoke `E2E_SHOT_DIR` on disk.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';

import { expect } from './fixtures';

/** An assertion handle for the first non-empty error alert, e.g. `await expectAlert(page).toBeVisible()`. */
export function expectAlert(page: Page) {
  return expect(page.locator('[role="alert"]').filter({ hasText: /\S/ }).first());
}

/** Attach a PNG screenshot of the page (or a specific locator) to the test report under `name`. */
export async function attachShot(
  testInfo: TestInfo,
  target: Page | Locator,
  name: string,
): Promise<void> {
  await testInfo.attach(name, { body: await target.screenshot(), contentType: 'image/png' });
}
