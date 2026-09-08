/** A personal journey through saved places, one canonical schedule, and one dated change. */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

async function addPlace(page: Page, name: string, address?: string): Promise<void> {
  await page.getByRole('button', { name: 'Add place' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add place' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  if (address) await dialog.getByRole('textbox', { name: 'Address (optional)' }).fill(address);
  await dialog.getByRole('button', { name: 'Save place' }).click();
  await expect(dialog).not.toBeVisible();
}

test('a person defines default work and changes one date', async ({ page }) => {
  await page.clock.setFixedTime('2026-09-06T12:00:00.000Z');
  await signUpAndOnboard(page, 'WorkSchedule');
  await page.goto('/settings/places', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await addPlace(page, 'Main library', '10 Library Lane');
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

  await page.goto('/settings/work-schedule', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Work schedule' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'Create default schedule' }).click();
  const scheduleDialog = page.getByRole('dialog', { name: 'Create default schedule' });
  await scheduleDialog.getByLabel('Schedule applies from').fill('2026-09-07');
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
  await dateDialog.getByLabel('Date').fill('2026-09-14');
  await dateDialog.getByRole('button', { name: 'Add work period' }).click();
  await dateDialog
    .getByRole('combobox', { name: 'Location for period 1' })
    .selectOption({ label: 'Main library' });
  await dateDialog.getByRole('button', { name: 'Save date change' }).click();
  await expect(dateDialog).not.toBeVisible();
  await expect(page.getByText('Sep 14, 2026')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('9:00 AM–5:00 PM · Ceramics studio').first()).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByText('Sep 14, 2026')).toBeVisible();

  await page.goto('/settings/places', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Set up automatic location' }).click();
  const placeDialog = page.getByRole('dialog', { name: 'Edit place' });
  await placeDialog.getByRole('button', { name: 'Choose on map' }).click();
  const map = placeDialog.locator('.maplibregl-canvas');
  await expect(map).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await map.click({ position: { x: 160, y: 120 } });
  await expect(placeDialog.getByRole('status')).toContainText('Map location selected');
  await placeDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('switch', { name: 'Automatic location' })).toBeVisible();
});

test('a person resolves an unmatched connected-account place name', async ({ page }) => {
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
  await expect(page.getByText('Decatur Cafe')).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await addPlace(page, 'Decatur cafe');

  await page.getByRole('button', { name: 'Resolve' }).click();
  const dialog = page.getByRole('dialog', { name: 'Resolve Decatur Cafe' });
  await dialog.getByRole('combobox', { name: 'Saved place' }).selectOption({
    label: 'Decatur cafe',
  });
  await dialog.getByRole('button', { name: 'Resolve', exact: true }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Decatur Cafe')).not.toBeVisible();
  expect(resolution).toMatchObject({ action: 'link_place', placeId: expect.any(String) });
});

test('a person can reconnect work-schedule access from Connected accounts', async ({ page }) => {
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
