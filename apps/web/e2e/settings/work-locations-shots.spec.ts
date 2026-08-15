/** Visual evidence for the simplified personal work-location settings flow. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const SHOT_DIR = resolve('../../docs/design/audits/screenshots/2026-08-14-work-locations');

/** Add one saved place through the same compact dialog a person uses. */
async function addPlace(page: Page, name: string, address?: string): Promise<void> {
  await page.getByRole('button', { name: 'Add place' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add place' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  if (address) await dialog.getByRole('textbox', { name: 'Address' }).fill(address);
  await dialog.getByRole('button', { name: 'Save place' }).click();
  await expect(dialog).not.toBeVisible();
}

test('captures the standard work-location settings review set', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await signUpAndOnboard(page, 'WorkLocationShots');
  await page.goto('/settings/work-locations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Work locations' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  await addPlace(page, 'Eastside library', '2851 East Bonanza Road');
  await addPlace(page, 'Ceramics studio', '101 Arts District Way');
  await addPlace(page, 'Downtown coworking');

  const places = page.getByRole('region', { name: 'Saved places' });
  await places.getByRole('button', { name: 'Actions for Eastside library' }).click();
  await page.getByRole('menuitem', { name: 'Make home' }).click();
  await places.getByRole('button', { name: 'Set Ceramics studio as current location' }).click();
  await expect(places.getByText('Current', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add schedule' }).click();
  const schedule = page.getByRole('dialog', { name: 'Add schedule' });
  await schedule.getByRole('combobox', { name: 'Place' }).selectOption({
    label: 'Downtown coworking',
  });
  await schedule.getByRole('combobox', { name: 'Schedule' }).selectOption('weekly_all_day');
  await schedule.getByRole('button', { name: /Effective from/ }).click();
  await page.getByRole('button', { name: '2026-08-17' }).click();
  await schedule.getByRole('button', { name: 'Save schedule' }).click();
  await expect(schedule).not.toBeVisible();

  for (const viewport of [
    { label: '1440x900', width: 1440, height: 900 },
    { label: '390x844', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width === 390) {
      await expect
        .poll(async () => (await page.getByRole('banner').boundingBox())?.x ?? 390)
        .toBeLessThan(24);
      await expect
        .poll(async () => (await page.getByRole('banner').boundingBox())?.width ?? 0)
        .toBeGreaterThan(340);
    }
    for (const scheme of ['light', 'dark'] as const) {
      await setColorScheme(page, scheme);
      await page.waitForTimeout(250);
      await page.evaluate(async () => document.fonts.ready);
      await page.screenshot({
        path: resolve(SHOT_DIR, `work-locations-${viewport.label}-${scheme}.png`),
      });
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await setColorScheme(page, 'light');
  const addPlaceButton = page.getByRole('button', { name: 'Add place' });
  await addPlaceButton.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(addPlaceButton).toBeFocused();
  expect(
    await addPlaceButton.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
    }),
  ).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Add place' }).getByLabel('Name')).toBeFocused();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(SHOT_DIR, 'work-locations-add-place-1440x900-light.png') });

  await page.keyboard.press('Escape');
  await expect(addPlaceButton).toBeFocused();
  await page.setViewportSize({ width: 320, height: 844 });
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);
});
