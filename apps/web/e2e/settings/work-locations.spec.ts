/** A personal journey through saved places, one canonical schedule, and one dated change. */
import type { Locator, Page, Route } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

async function fixtureOpenFreeMap(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', async (route) => {
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
            paint: { 'background-color': '#d9e3ea' },
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

async function addPlace(page: Page, name: string, address?: string): Promise<void> {
  await page.getByRole('button', { name: 'Add place' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add place' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  if (address) {
    await dialog.getByRole('combobox', { name: 'Address (optional)' }).fill(address);
    await dialog.getByRole('option').first().click();
    await expect(dialog.locator('.maplibregl-marker')).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Save place' }).click();
  await expect(dialog).not.toBeVisible();
}

async function chooseDate(
  page: Page,
  scope: Page | Locator,
  label: string,
  date: string,
): Promise<void> {
  await scope.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  const calendar = page.getByRole('grid', { name: new RegExp(label) });
  await calendar.getByRole('button', { name: date }).click();
}

test('a person defines default work and changes one date', async ({ page, context }) => {
  await fixtureOpenFreeMap(page);
  await bypassStalledDevProxy(page);
  const appOrigin = new URL(process.env['APP_URL'] ?? 'https://docket.localhost').origin;
  await context.grantPermissions(['geolocation'], { origin: appOrigin });
  await context.setGeolocation({ latitude: 36.1716, longitude: -115.1391 });
  await signUpAndOnboard(page, 'WorkSchedule');
  await page.goto('/settings/places', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'Set up automatic location' }).click();
  const placeDialog = page.getByRole('dialog', { name: 'Set up automatic location' });
  await placeDialog.getByRole('textbox', { name: 'Name' }).fill('Main library');
  await placeDialog.getByRole('combobox', { name: 'Address (optional)' }).fill('10 Library Lane');
  await placeDialog.getByRole('option').first().click();
  const marker = placeDialog.locator('.maplibregl-marker');
  await expect(marker).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await marker.hover();
  const markerBox = await marker.boundingBox();
  if (!markerBox) throw new Error('The selected address marker is not visible');
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    markerBox.x + markerBox.width / 2 + 80,
    markerBox.y + markerBox.height / 2,
    {
      steps: 4,
    },
  );
  await page.mouse.up();
  await expect(placeDialog.getByRole('button', { name: 'Use suggested address' })).toBeVisible();
  await placeDialog.getByRole('button', { name: 'Use suggested address' }).click();
  await placeDialog.getByRole('button', { name: 'Save and turn on' }).click();
  await expect(page.getByRole('switch', { name: 'Automatic location' })).toBeChecked();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('switch', { name: 'Automatic location' })).toBeChecked({
    timeout: TIMEOUTS.pageReady,
  });
  await addPlace(page, 'Ceramics studio');
  const savedPlaces = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Saved places' }) });
  await savedPlaces.getByRole('button', { name: 'Actions for Main library' }).click();
  await page.getByRole('menuitem', { name: 'Make home' }).click();
  await savedPlaces.getByRole('button', { name: 'Actions for Main library' }).click();
  await page.getByRole('menuitem', { name: 'Set as current place' }).click();
  await expect(savedPlaces.getByText('Home', { exact: true })).toBeVisible();
  await expect(savedPlaces.getByText('Current', { exact: true })).toBeVisible();

  await page.clock.setFixedTime('2026-09-08T12:00:00.000Z');
  await page.goto('/settings/work-schedule', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Work schedule' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'Create default schedule' }).click();
  const scheduleDialog = page.getByRole('dialog', { name: 'Create default schedule' });
  await chooseDate(page, scheduleDialog, 'Schedule applies from', '2026-09-14');
  await scheduleDialog.getByRole('button', { name: /Monday/ }).click();
  await scheduleDialog.getByRole('button', { name: 'Add work period' }).click();
  await scheduleDialog
    .getByRole('combobox', { name: 'Location for period 1' })
    .selectOption({ label: 'Ceramics studio' });
  await scheduleDialog.getByRole('button', { name: 'Copy day' }).click();
  await page.getByRole('menuitem', { name: 'Tuesday' }).click();
  await scheduleDialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(scheduleDialog).not.toBeVisible();
  await expect(page.getByText('9:00 AM–5:00 PM · Ceramics studio').first()).toBeVisible();

  await page.getByRole('button', { name: 'Add date change' }).click();
  const dateDialog = page.getByRole('dialog', { name: 'Add date change' });
  await chooseDate(page, dateDialog, 'Date', '2026-09-21');
  await dateDialog.getByRole('button', { name: 'Add work period' }).click();
  await dateDialog
    .getByRole('combobox', { name: 'Location for period 1' })
    .selectOption({ label: 'Main library' });
  await dateDialog.getByRole('button', { name: 'Save date change' }).click();
  await expect(dateDialog).not.toBeVisible();
  await expect(page.getByText('Sep 21, 2026')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('9:00 AM–5:00 PM · Ceramics studio').first()).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByText('Sep 21, 2026')).toBeVisible();
});

test('a person resolves an unmatched connected-account place name', async ({ page }) => {
  await fixtureOpenFreeMap(page);
  await bypassStalledDevProxy(page);
  await signUpAndOnboard(page, 'WorkScheduleResolve');
  let resolved = false;
  let resolution: unknown;
  await page.route('**/v1/me/work-location/changes', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: resolved
          ? []
          : [
              {
                id: '01BX5ZZKBKACTAV9WEVGEMMVT2',
                connectionId: '01BX5ZZKBKACTAV9WEVGEMMVT3',
                provider: 'google',
                accountLabel: 'ada@example.com',
                kind: 'unmatched_place',
                payload: {
                  kind: 'unmatched_place',
                  label: 'Decatur Cafe',
                  normalizedLabel: 'decatur cafe',
                  externalEventId: 'provider-decatur-cafe',
                },
                createdAt: '2026-09-05T00:00:00.000Z',
                updatedAt: '2026-09-05T00:00:00.000Z',
              },
            ],
      }),
    });
  });
  await page.route('**/v1/me/work-location/changes/*', async (route) => {
    resolution = route.request().postDataJSON();
    resolved = true;
    await route.fulfill({ status: 204 });
  });
  await page.goto('/settings/places', { waitUntil: 'domcontentloaded' });
  const unmatchedNames = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Unmatched names' }) });
  await expect(unmatchedNames.getByText('Decatur Cafe', { exact: true })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await addPlace(page, 'Decatur cafe');

  await page.getByRole('button', { name: 'Resolve' }).click();
  const dialog = page.getByRole('dialog', { name: 'Resolve Decatur Cafe' });
  await dialog.getByRole('combobox', { name: 'Saved place' }).selectOption({
    label: 'Decatur cafe',
  });
  await dialog.getByRole('button', { name: 'Resolve', exact: true }).click();

  await expect(dialog).not.toBeVisible();
  await expect(unmatchedNames.getByText('Decatur Cafe', { exact: true })).not.toBeVisible();
  expect(resolution).toMatchObject({ action: 'link_place', placeId: expect.any(String) });
});

test('a person can reconnect work-schedule access from Connected accounts', async ({ page }) => {
  await bypassStalledDevProxy(page);
  await signUpAndOnboard(page, 'WorkScheduleReconnect');
  await page.route('**/v1/me/work-location/sync-state', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ready: false,
        accounts: [
          {
            connectionId: '01BX5ZZKBKACTAV9WEVGEMMVT3',
            provider: 'google',
            accountLabel: 'ada@example.com',
            state: 'action_required',
            reason: 'reauth_required',
            capabilities: {
              supported: true,
              recurring: true,
              timed: true,
              exceptions: true,
              writes: true,
            },
            bootstrapCompletedAt: '2026-09-05T00:00:00.000Z',
            lastSucceededAt: '2026-09-05T00:00:00.000Z',
            pendingWrites: 0,
          },
        ],
      }),
    });
  });
  await page.goto('/settings/connected-accounts', { waitUntil: 'domcontentloaded' });

  const reconnect = page.getByRole('link', { name: 'Reconnect' });
  await expect(reconnect).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await reconnect.click();
  await expect(page).toHaveURL(/\/settings\/connections\/google-calendar/);
});
