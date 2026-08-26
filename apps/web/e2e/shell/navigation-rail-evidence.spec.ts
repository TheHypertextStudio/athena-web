/** Authenticated visual evidence for the Material 3 shell navigation rail. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const SHOT_ROOT = resolve(
  import.meta.dirname,
  '../../../../docs/design/audits/screenshots/2026-08-25-shell-navigation-rail',
);

test.use({ serviceWorkers: 'block' });

/** Assert that the shell never expands the document beyond the visible viewport. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test('the labeled navigation rail keeps daily work visible at every density', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOT_ROOT, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signUpAndOnboard(page, 'NavigationRailAudit');
  await page.goto('/today', {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: 'Plan today with Athena' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  const collapse = page.getByRole('button', { name: 'Collapse navigation' });
  await expect(collapse).toBeVisible();
  await setColorScheme(page, 'light');
  await page.screenshot({ path: resolve(SHOT_ROOT, 'expanded-1440x900-light.png') });

  await collapse.focus();
  await page.screenshot({ path: resolve(SHOT_ROOT, 'expanded-focus-1440x900-light.png') });
  await collapse.click();
  await page.waitForTimeout(250);

  const primary = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(primary).toHaveText(
    /Today[\s\S]*My Work[\s\S]*Calendar[\s\S]*Inbox[\s\S]*Search[\s\S]*Athena[\s\S]*More/,
  );
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeFocused();
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-1440x900-light.png') });

  await page.getByRole('button', { name: 'More navigation' }).click();
  const more = page.getByRole('menu');
  await expect(more.getByText('Workspace')).toBeVisible();
  await expect(more.getByRole('menuitem', { name: 'Projects' })).toBeVisible();
  await expect(more.getByText('Manage')).toBeVisible();
  await expect(more.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-more-1440x900-light.png') });

  await page.keyboard.press('Escape');
  await expect(more).toBeHidden();
  await setColorScheme(page, 'dark');
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-1440x900-dark.png') });

  await page.setViewportSize({ width: 1024, height: 900 });
  await setColorScheme(page, 'light');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-1024x900-light.png') });
  await setColorScheme(page, 'dark');
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-1024x900-dark.png') });

  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalOverflow(page);
});
