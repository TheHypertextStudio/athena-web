/** Four-matrix visual and interaction evidence for the shared roster recovery state. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const SHOT_ROOT = resolve(
  import.meta.dirname,
  '../../../../docs/design/audits/screenshots/2026-08-23-work-view-recovery',
);

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test.use({ serviceWorkers: 'block' });

test('Projects presents a usable recovery state in both themes and widths', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOT_ROOT, { recursive: true });
  const { orgId } = await signUpAndOnboard(page, 'WorkViewRecovery');
  let queryCount = 0;
  await page.route(`**/v1/orgs/${orgId}/work-views/query`, async (route) => {
    queryCount += 1;
    await route.fulfill({
      status: 422,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://docket.hypertext.studio/problems/validation_error',
        title: 'Some information needs attention.',
        status: 422,
        code: 'validation_error',
      }),
    });
  });

  await page.goto(orgHref(orgId, 'projects'), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  const alert = page.getByRole('alert').filter({ hasText: 'Projects could not load' });
  await expect(alert).toContainText('Projects could not load', { timeout: TIMEOUTS.pageReady });
  await expect(alert).toContainText('Your filters and display settings are safe.');

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const scheme of ['light', 'dark'] as const) {
      await setColorScheme(page, scheme);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: resolve(SHOT_ROOT, `projects-${viewport.name}-${scheme}.png`),
      });
    }
  }

  const retry = page.getByRole('button', { name: 'Try again' });
  await retry.focus();
  await expect(retry).toBeFocused();
  await retry.click();
  await expect.poll(() => queryCount).toBeGreaterThan(1);
});
