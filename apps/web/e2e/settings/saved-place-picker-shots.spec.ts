/** Visual evidence for the repaired saved-place location picker. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page, Route } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const SHOT_DIR = resolve('../../docs/design/audits/screenshots/2026-09-08-saved-place-picker');

async function fixtureOpenFreeMap(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', async (route) => {
    const dark = route.request().url().endsWith('/dark');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        sources: {
          fixture: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
          },
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': dark ? '#17202a' : '#d9e3ea' },
          },
          {
            id: 'fixture-points',
            type: 'circle',
            source: 'fixture',
            paint: { 'circle-radius': 1, 'circle-opacity': 0 },
          },
        ],
      }),
    });
  });
}

async function bypassStalledDevProxy(page: Page): Promise<void> {
  const apiOrigin = process.env['API_URL'];
  if (!apiOrigin) return;
  const forward = async (route: Route): Promise<void> => {
    const source = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiOrigin}${source.pathname}${source.search}` });
    await route.fulfill({ response });
  };
  await page.route('**/v1/**', forward);
  await page.route('**/api/auth/**', forward);
}

test('captures the selected saved-place picker at both widths and in both themes', async ({
  page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await fixtureOpenFreeMap(page);
  await bypassStalledDevProxy(page);
  await signUpAndOnboard(page, 'SavedPlacePickerShots');
  await page.goto('/settings/places', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'Add place' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add place' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Main library');
  const address = dialog.getByRole('combobox', { name: 'Address (optional)' });
  await address.fill('10 Library Lane');
  await dialog.getByRole('option').first().click();
  const marker = dialog.locator('.maplibregl-marker');
  await expect(marker).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await marker.hover();
  await expect(dialog.locator('.maplibregl-ctrl-attrib')).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'OpenMapTiles' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();

  for (const viewport of [
    { label: '1440x900', width: 1440, height: 900 },
    { label: '390x844', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const scheme of ['light', 'dark'] as const) {
      await setColorScheme(page, scheme);
      await address.focus();
      await expect(dialog.getByRole('listbox')).toHaveCount(0);
      const bounds = await dialog.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(bounds.scrollWidth).toBe(bounds.clientWidth);
      expect(await address.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      await page.screenshot({
        path: resolve(SHOT_DIR, `place-editor-${viewport.label}-${scheme}.png`),
        animations: 'disabled',
      });
    }
  }
});
