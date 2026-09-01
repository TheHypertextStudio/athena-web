/** Live visual and geometry evidence for Agenda quick create. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { CALENDAR_IDS, makeCalendarItem, makeCalendarLayer } from '../helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from '../helpers/calendar-routes';
import { ORIGIN } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';
import { assertDefined } from '@docket/test-utils';

const DAY = '2026-08-10';
const API_ORIGIN = process.env['API_URL'] ?? `https://api.${new URL(ORIGIN).hostname}`;
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
  await aside.getByRole('button', { name: 'Agenda display settings, 1×' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Timeline' })).toBeChecked();
  await page.getByRole('menuitemradio', { name: '2×' }).click();
  await expect(aside.getByRole('group', { name: 'Agenda zoom' })).toContainText('2×');
  await aside.getByRole('button', { name: 'Agenda display settings, 2×' }).click();
  await page.getByRole('menuitemradio', { name: '1×' }).click();
  const lane = aside.locator(`[data-schedule-lane="agenda:${DAY}"]`);
  await expect(lane).toBeVisible();
  await createAgendaRegion(lane);

  const dialog = page.getByRole('dialog', { name: 'Create calendar item' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.waitForTimeout(300);
  const selectedDraft = aside.locator('[data-schedule-region-selection]');
  await expect(selectedDraft).toBeVisible();
  const [dialogBox, asideBox, draftBox, titleBox] = await Promise.all([
    dialog.boundingBox(),
    aside.boundingBox(),
    selectedDraft.boundingBox(),
    dialog.getByLabel('Title').boundingBox(),
  ]);
  expect(dialogBox).not.toBeNull();
  expect(asideBox).not.toBeNull();
  expect(draftBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(assertDefined(dialogBox).x + assertDefined(dialogBox).width).toBeLessThanOrEqual(
    assertDefined(asideBox).x,
  );
  const draftGap =
    assertDefined(draftBox).x - (assertDefined(dialogBox).x + assertDefined(dialogBox).width);
  expect(draftGap).toBeGreaterThanOrEqual(0);
  expect(draftGap).toBeLessThanOrEqual(96);
  const draftCenter = assertDefined(draftBox).y + assertDefined(draftBox).height / 2;
  const titleCenter = assertDefined(titleBox).y + assertDefined(titleBox).height / 2;
  expect(Math.abs(titleCenter - draftCenter)).toBeLessThanOrEqual(24);

  await setColorScheme(page, 'light');
  await capture(page, 'desktop-light-overview');
  await setColorScheme(page, 'dark');
  await capture(page, 'desktop-dark-overview');
  await setColorScheme(page, 'light');

  const handle = dialog.getByRole('button', { name: 'Move create-event dialog' });
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Dialog handle has no browser geometry.');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 - 180, handleBox.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await dialog.boundingBox())?.x ?? Number.POSITIVE_INFINITY)
    .toBeLessThanOrEqual(assertDefined(dialogBox).x - 170);
  const overlayHost = page.locator('[data-shell-overlay-host]');
  const draggedBox = await dialog.boundingBox();
  const draggedHostBox = await overlayHost.boundingBox();
  expect(draggedBox).not.toBeNull();
  expect(draggedHostBox).not.toBeNull();
  expect(assertDefined(draggedBox).x).toBeLessThan(assertDefined(dialogBox).x);
  expect(assertDefined(draggedBox).x + assertDefined(draggedBox).width).toBeLessThanOrEqual(
    assertDefined(asideBox).x,
  );
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.waitForTimeout(100);
  const resizedDraggedBox = await dialog.boundingBox();
  const resizedHostBox = await overlayHost.boundingBox();
  expect(resizedDraggedBox).not.toBeNull();
  expect(resizedHostBox).not.toBeNull();
  const draggedLocalX = assertDefined(draggedBox).x - assertDefined(draggedHostBox).x;
  const resizedLocalX = assertDefined(resizedDraggedBox).x - assertDefined(resizedHostBox).x;
  expect(Math.abs(resizedLocalX - draggedLocalX)).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(state.itemCreates).toHaveLength(0);

  await dialog.getByRole('button', { name: /Edit schedule/ }).click();
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
  const mobileHost = mobileAside.locator('[data-agenda-create-host]');
  await expect(mobileHost).toBeVisible();
  await expect(mobileLane).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Move create-event dialog' })).toHaveCount(0);
  expect(
    await dialog.evaluate(
      (node) => node.parentElement?.closest('[data-agenda-create-host]') !== null,
    ),
  ).toBe(true);
  await setColorScheme(page, 'light');
  await capture(page, 'mobile-light-overview');
  await setColorScheme(page, 'dark');
  await capture(page, 'mobile-dark-overview');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.setViewportSize({ width: 820, height: 900 });
  await setColorScheme(page, 'light');
  const tabletLane = mobileAside.locator(`[data-schedule-lane="agenda:${DAY}"]`);
  await expect(tabletLane).toBeVisible();
  await createAgendaRegion(tabletLane);
  await expect(mobileAside.locator('[data-agenda-create-host]')).toBeVisible();
  await expect(tabletLane).toHaveCount(0);
  await capture(page, 'tablet-light-overview');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('quick create persists one-zone and split-zone events through a cold reload', async ({
  page,
}) => {
  await page.clock.setFixedTime('2026-08-10T17:00:00.000Z');
  await page.setViewportSize({ width: 1440, height: 900 });
  await signUpAndOnboard(page, 'AgendaQuickCreatePersistence');
  await page.goto('/today', { waitUntil: 'domcontentloaded' });

  const aside = page.getByRole('complementary', { name: 'Agenda' });
  const lane = aside.locator(`[data-schedule-lane="agenda:${DAY}"]`);
  const dialog = page.getByRole('dialog', { name: 'Create calendar item' });
  await expect(lane).toBeVisible();

  await createAgendaRegion(lane);
  await dialog.getByLabel('Title').fill('Local planning block');
  const oneZoneResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/v1/me/calendar/items'),
  );
  await dialog.getByRole('button', { name: 'Save' }).click();
  const oneZone = (await (await oneZoneResponse).json()) as CalendarItemOut;
  expect(oneZone.timezone).toBe('America/Los_Angeles');
  expect(oneZone.endTimezone ?? null).toBeNull();
  await expect
    .poll(() =>
      page.evaluate(
        (id) => document.activeElement?.getAttribute('data-schedule-item-body') === id,
        oneZone.id,
      ),
    )
    .toBe(true);

  await createAgendaRegion(lane);
  await dialog.getByLabel('Title').fill('New York handoff');
  await dialog.getByRole('button', { name: /Edit schedule/ }).click();
  await dialog.getByRole('button', { name: 'Time zone' }).click();
  const zoneDialog = page.getByRole('dialog', { name: 'Event time zone' });
  await zoneDialog.getByLabel('Use separate start and end time zones').check();
  await zoneDialog.getByRole('button', { name: /Ends/ }).click();
  const zoneSearch = zoneDialog.getByRole('combobox', { name: 'Search time zones' });
  await zoneSearch.fill('America/New_York');
  await zoneSearch.press('Enter');
  await zoneDialog.getByRole('button', { name: 'OK' }).click();
  await dialog.getByLabel('End time').fill('14:00');
  const splitZoneResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/v1/me/calendar/items'),
  );
  await dialog.getByRole('button', { name: 'Save' }).click();
  const splitZone = (await (await splitZoneResponse).json()) as CalendarItemOut;
  expect(splitZone.timezone).toBe('America/Los_Angeles');
  expect(splitZone.endTimezone).toBe('America/New_York');

  for (const item of [oneZone, splitZone]) {
    const response = await page.request.get(`${API_ORIGIN}/v1/me/calendar/items/${item.id}`);
    expect(response.ok(), `read ${item.title}: ${String(response.status())}`).toBe(true);
    expect((await response.json()) as CalendarItemOut).toMatchObject({
      id: item.id,
      timezone: item.timezone,
      endTimezone: item.endTimezone ?? null,
    });
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(aside.getByText(oneZone.title)).toBeVisible();
  await expect(aside.getByText(splitZone.title)).toBeVisible();
});
