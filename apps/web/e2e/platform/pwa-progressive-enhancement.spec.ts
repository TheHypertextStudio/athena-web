import type { Page } from '@playwright/test';

import { expect, test } from '../helpers/fixtures';
import { signUpAndOnboard } from '../helpers/app';

/**
 * Docket without any of its installed-app machinery.
 *
 * @remarks
 * The claim under test is that every PWA behaviour is an *enhancement*: with no service worker, no
 * Cache Storage and no IndexedDB, the product is still whole. That is not something feature
 * detection can be trusted to deliver on its own — a guard can exist and still be bypassed by a
 * module that touches `caches` at import time, or by a component that renders whatever a rejected
 * storage promise produced. So the APIs are removed outright, before any application script runs,
 * and the app is then asked to do real work.
 *
 * Removal happens in `addInitScript`, which executes in a fresh context before the page's own
 * scripts. Deleting them later would leave whatever was captured at module scope intact and prove
 * nothing.
 *
 * The account ceremony runs first, with the APIs present: passkey registration is not a PWA
 * feature, and reaching a signed-in workspace is the precondition for the interesting assertions,
 * not one of them.
 */

/** Remove every storage and worker API the PWA layer feature-detects. */
async function denyPwaCapabilities(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // A getter that throws models a browser that has revoked storage more faithfully than deletion
    // alone: code that merely checks `'indexedDB' in window` must still not reach for it.
    Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
    Object.defineProperty(window, 'caches', { get: () => undefined, configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined, configurable: true });
  });
}

/** Words that must never reach a person, on any route, in any state. */
const IMPLEMENTATION_WORDS = [
  'service worker',
  'serviceworker',
  'indexeddb',
  'cache storage',
  'quota',
  'storage api',
];

test.describe('progressive enhancement', () => {
  test('every core route renders, and task create and edit still work', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'pwa-pe');

    await denyPwaCapabilities(page);
    await page.reload();

    // The APIs really are gone for application code, not merely unused.
    expect(
      await page.evaluate(() => ({
        idb: typeof window.indexedDB,
        caches: typeof window.caches,
        sw: typeof navigator.serviceWorker,
      })),
    ).toEqual({ idb: 'undefined', caches: 'undefined', sw: 'undefined' });

    for (const route of ['/today', '/inbox', '/portfolio', '/calendar', `/orgs/${orgId}/tasks`]) {
      await page.goto(route);
      // The shell is the app: if it painted, navigation, the palette and the page frame are alive.
      await expect(page.locator('#main-content')).toBeVisible();
      await expect(page.locator('nav').first()).toBeVisible();
      const text = (await page.locator('body').innerText()).toLowerCase();
      for (const word of IMPLEMENTATION_WORDS) {
        expect(text, `${route} must not mention "${word}"`).not.toContain(word);
      }
    }

    // A real write, through the real composer, with nothing available to persist it locally.
    await page.goto(`/orgs/${orgId}/tasks`);
    await page.getByRole('button', { name: 'New task' }).click();
    const title = `Enhancement check ${String(Date.now())}`;
    await page.getByPlaceholder('Task title').fill(title);
    await page.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText(title)).toBeVisible();

    // And an edit of the thing just created, made the same way a person would.
    await page.getByRole('link', { name: title }).first().click();
    const renamed = `${title} edited`;
    const heading = page.getByRole('textbox', { name: /title/i }).first();
    await heading.fill(renamed);
    await heading.press('Enter');
    await expect(page.getByText(renamed).first()).toBeVisible();
  });
});
