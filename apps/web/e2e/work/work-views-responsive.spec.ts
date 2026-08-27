import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 844 },
] as const;

test('typed roster controls stay operable at every supported width and theme', async ({ page }) => {
  test.setTimeout(360_000);
  const { orgId } = await signUpAndOnboard(page, 'TypedWorkViewsResponsive');

  for (const route of ['tasks', 'projects', 'programs', 'initiatives'] as const) {
    await page.goto(orgHref(orgId, route), {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.pageReady,
    });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const scheme of ['light', 'dark'] as const) {
        await setColorScheme(page, scheme);
        const toolbar = page.getByRole('toolbar', {
          name: `${route[0]?.toUpperCase()}${route.slice(1, -1)} view controls`,
        });
        await expect(toolbar).toBeVisible({ timeout: TIMEOUTS.pageReady });
        const widths = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        }));
        expect(widths.document).toBeLessThanOrEqual(widths.viewport);
        await expect(page.getByRole('button', { name: 'Filter' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'More view controls' })).toBeVisible();
      }
    }
  }
});
