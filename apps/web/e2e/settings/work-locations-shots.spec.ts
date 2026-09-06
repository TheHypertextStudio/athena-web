/** Visual evidence for Work schedule and Places settings. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page, Route } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const SHOT_DIR = resolve(
  '../../docs/design/audits/screenshots/2026-09-05-work-schedule-and-places',
);

async function addPlace(page: Page, name: string, address?: string): Promise<void> {
  await page.getByRole('button', { name: 'Add place' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add place' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  if (address) await dialog.getByRole('textbox', { name: 'Address (optional)' }).fill(address);
  await dialog.getByRole('button', { name: 'Save place' }).click();
  await expect(dialog).not.toBeVisible();
}

async function seedSchedule(page: Page): Promise<void> {
  await page.goto('/settings/work-schedule', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Create default schedule' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create default schedule' });
  await dialog.getByLabel('Schedule applies from').fill('2026-09-07');
  await dialog.getByRole('button', { name: /Monday/ }).click();
  await dialog.getByRole('button', { name: 'Add work period' }).click();
  await dialog
    .getByRole('combobox', { name: 'Location for period 1' })
    .selectOption({ label: 'Eastside library' });
  for (const weekday of ['Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
    await dialog.getByRole('button', { name: 'Copy day' }).click();
    await page.getByRole('menuitem', { name: weekday }).click();
  }
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Add date change' }).click();
  const dateDialog = page.getByRole('dialog', { name: 'Add date change' });
  await dateDialog.getByLabel('Date').fill('2026-09-14');
  await dateDialog.getByRole('button', { name: 'Save date change' }).click();
  await expect(dateDialog).not.toBeVisible();
}

async function waitForSettingsContent(
  page: Page,
  route: 'work-schedule' | 'places',
): Promise<void> {
  if (route === 'work-schedule') {
    await expect(page.getByText('9:00 AM–5:00 PM · Eastside library')).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await expect(page.getByRole('button', { name: 'Add date change' })).toBeVisible();
    return;
  }
  await expect(page.getByRole('heading', { name: 'Saved places' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByText('Eastside library', { exact: true })).toBeVisible();
}

async function captureLoadingState(
  page: Page,
  route: 'work-schedule' | 'places',
  requestPatterns: readonly string[],
): Promise<void> {
  let releaseRequests: (() => void) | undefined;
  const requestsReleased = new Promise<void>((resolve) => {
    releaseRequests = resolve;
  });
  const holdRequest = async (request: Route): Promise<void> => {
    await requestsReleased;
    await request.abort();
  };
  for (const pattern of requestPatterns) await page.route(pattern, holdRequest);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: route === 'work-schedule' ? 'Work schedule' : 'Places' }),
  ).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
  await page.screenshot({
    path: resolve(SHOT_DIR, 'loading', `${route}-390x844-light.png`),
    animations: 'disabled',
  });

  releaseRequests?.();
  for (const pattern of requestPatterns) await page.unroute(pattern, holdRequest);
}

test('captures both settings destinations at the required widths and themes', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.clock.setFixedTime('2026-09-05T17:00:00.000Z');
  await signUpAndOnboard(page, 'WorkScheduleShots');
  await page.goto('/settings/places', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await addPlace(page, 'Eastside library', '2851 East Bonanza Road');
  await addPlace(page, 'Ceramics studio', '101 Arts District Way');
  await addPlace(page, 'Downtown coworking');
  await seedSchedule(page);

  for (const route of ['work-schedule', 'places'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/settings/${route}`, { waitUntil: 'domcontentloaded' });
    await waitForSettingsContent(page, route);
    for (const viewport of [
      { label: '1440x900', width: 1440, height: 900 },
      { label: '390x844', width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      if (route === 'places' && viewport.width === 390) {
        const labelBox = await page.getByText('Automatic location is not set up').boundingBox();
        const buttonBox = await page
          .getByRole('button', { name: 'Set up automatic location' })
          .boundingBox();
        if (!labelBox || !buttonBox) throw new Error('Automatic-location setup row is not visible');
        expect(buttonBox.y).toBeGreaterThanOrEqual(labelBox.y + labelBox.height);
      }
      for (const scheme of ['light', 'dark'] as const) {
        await setColorScheme(page, scheme);
        await page.evaluate(async () => document.fonts.ready);
        await page.screenshot({
          path: resolve(SHOT_DIR, `${route}-${viewport.label}-${scheme}.png`),
          animations: 'disabled',
        });
      }
    }
    await page.setViewportSize({ width: 320, height: 844 });
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  }
});

test('captures the mounted loading state for both settings destinations', async ({ page }) => {
  mkdirSync(resolve(SHOT_DIR, 'loading'), { recursive: true });
  await signUpAndOnboard(page, 'WorkScheduleLoadingShots');
  await page.setViewportSize({ width: 390, height: 844 });
  await setColorScheme(page, 'light');

  await page.goto('/settings/work-schedule', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Work schedule' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await captureLoadingState(page, 'work-schedule', [
    '**/v1/me/work-location/places',
    '**/v1/me/work-location/schedule',
    '**/v1/me/work-location/changes',
  ]);

  await page.goto('/settings/places', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await captureLoadingState(page, 'places', [
    '**/v1/me/work-location/places',
    '**/v1/me/work-location/changes',
  ]);
});
