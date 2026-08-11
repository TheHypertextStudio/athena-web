/** Live visual and geometry evidence for Agenda quick create. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { CALENDAR_IDS, makeCalendarItem, makeCalendarLayer } from '../helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from '../helpers/calendar-routes';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const DAY = '2026-08-10';
const SHOT_DIR = resolve(
  process.cwd(),
  '../../docs/design/audits/screenshots/2026-08-10-agenda-quick-create',
);

async function createAgendaRegion(lane: Locator): Promise<void> {
  await lane.focus();
  await lane.press('Enter');
}

async function capture(page: Page, name: string): Promise<void> {
  await page.locator('nextjs-portal').evaluateAll((elements) => {
    for (const element of elements) (element as HTMLElement).style.display = 'none';
  });
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(SHOT_DIR, `${name}.png`) });
}

test.use({ timezoneId: 'America/Los_Angeles' });

test('Agenda quick create stays outside the rail across responsive themes', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.clock.setFixedTime('2026-08-10T17:00:00.000Z');
  await page.setViewportSize({ width: 1440, height: 900 });
  await signUpAndOnboard(page, 'AgendaQuickCreate');

  const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
  const items = [
    makeCalendarItem({
      id: CALENDAR_IDS.existingNativeItem,
      layerId: layer.id,
      title: 'Project review',
      startsAt: '2026-08-10T15:00:00.000Z',
      endsAt: '2026-08-10T16:00:00.000Z',
      timezone: 'America/Los_Angeles',
    }),
  ];
  const state = calendarRouteState({
    layers: [layer],
    items,
    preferences: { timezone: 'America/Los_Angeles' },
    agendaResponse: { date: DAY, entries: [] },
  });
  await installCalendarRoutes(page, state);
  await page.goto('/today', { waitUntil: 'domcontentloaded' });

  const aside = page.getByRole('complementary', { name: 'Agenda' });
  await expect(aside).toBeVisible();
  await expect(aside.getByRole('group', { name: 'Agenda zoom' })).toContainText('1×');
  const lane = aside.locator(`[data-schedule-lane="agenda:${DAY}"]`);
  await expect(lane).toBeVisible();
  await createAgendaRegion(lane);

  const dialog = page.getByRole('dialog', { name: 'Create calendar item' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  const [dialogBox, asideBox] = await Promise.all([dialog.boundingBox(), aside.boundingBox()]);
  expect(dialogBox).not.toBeNull();
  expect(asideBox).not.toBeNull();
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(asideBox!.x);
  await page.waitForTimeout(300);
  const handle = dialog.getByRole('button', { name: 'Move create dialog' });
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Dialog handle has no browser geometry.');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 180, handleBox.y + 80, { steps: 8 });
  await page.mouse.up();
  const draggedBox = await dialog.boundingBox();
  expect(draggedBox).not.toBeNull();
  expect(draggedBox!.x).toBeGreaterThan(dialogBox!.x);
  expect(draggedBox!.x + draggedBox!.width).toBeLessThanOrEqual(asideBox!.x);
  expect(state.itemCreates).toHaveLength(0);

  await setColorScheme(page, 'light');
  await capture(page, 'desktop-light-overview');
  await setColorScheme(page, 'dark');
  await capture(page, 'desktop-dark-overview');
  await setColorScheme(page, 'light');

  await dialog.getByRole('button', { name: 'Edit date and time' }).click();
  await expect(dialog.getByLabel('Start date')).toBeVisible();
  await expect(dialog.getByLabel('Start time')).toBeVisible();
  await dialog.getByRole('button', { name: 'Time zone' }).click();
  const zoneDialog = page.getByRole('dialog', { name: 'Event time zone' });
  await expect(zoneDialog.getByLabel('Search time zones')).toBeVisible();
  await zoneDialog.getByLabel('Search time zones').fill('PST');
  await expect(zoneDialog.getByText('Los Angeles', { exact: false }).first()).toBeVisible();
  await capture(page, 'desktop-light-timezone-search');
  await zoneDialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Show Agenda' }).click();
  const mobileAside = page.getByRole('dialog', { name: 'Agenda' });
  await expect(mobileAside).toBeVisible();
  const mobileLane = mobileAside.locator(`[data-schedule-lane="agenda:${DAY}"]`);
  await expect(mobileLane).toBeVisible();
  await createAgendaRegion(mobileLane);
  await expect(dialog).toHaveAttribute('data-create-presentation', 'agenda-mobile');
  await setColorScheme(page, 'light');
  await capture(page, 'mobile-light-overview');
  await setColorScheme(page, 'dark');
  await capture(page, 'mobile-dark-overview');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
