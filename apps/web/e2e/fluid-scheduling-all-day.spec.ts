/** Browser coverage for editable all-day true-edge pointer resize and keyboard move gestures. */
import { CalendarItemId } from '@docket/types';
import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from './helpers/app';
import {
  CALENDAR_IDS,
  makeCalendarItem,
  makeCalendarLayer,
  shiftDate,
} from './helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from './helpers/calendar-routes';
import { attachCalendarScreenshot, scheduleLane } from './helpers/calendar-ui';
import { expect, test } from './helpers/fixtures';

const ANCHOR_DATE = '2026-07-13';
const NEXT_DATE = shiftDate(ANCHOR_DATE, 1);
const THIRD_DATE = shiftDate(ANCHOR_DATE, 2);
const ALL_DAY_ITEM_ID = CalendarItemId.parse('G7NV2AHRZ6ENW3BJS08FPX4CKT');

/** Locate only full-calendar segments, excluding the shell Agenda's shared canvas. */
function allDaySegments(page: Page, itemId: string): Locator {
  return page.locator('main#main-content').locator(`[data-schedule-all-day-item="${itemId}"]`);
}

/** Drag one visible all-day edit control horizontally into a target date lane. */
async function dragAllDayControlToDate(
  page: Page,
  control: Locator,
  targetDate: string,
  targetFraction = 0.5,
): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  const [controlBox, laneBox] = await Promise.all([
    control.boundingBox(),
    scheduleLane(page, targetDate).boundingBox(),
  ]);
  if (!controlBox || !laneBox) throw new Error('All-day gesture has no browser geometry.');
  const from = {
    x: controlBox.x + controlBox.width / 2,
    y: controlBox.y + controlBox.height / 2,
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(laneBox.x + laneBox.width * targetFraction, from.y, { steps: 8 });
  await page.mouse.up();
}

test.use({ timezoneId: 'UTC', video: 'on' });

test('moves and resizes a writable all-day range from its true edges', async ({
  page,
}, testInfo) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
  await signUpAndOnboard(page, 'FluidAllDay');
  const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
  const item = makeCalendarItem({
    id: ALL_DAY_ITEM_ID,
    layerId: layer.id,
    kind: 'native_event',
    title: 'Company offsite',
    startsAt: null,
    endsAt: null,
    allDayStartDate: ANCHOR_DATE,
    allDayEndDate: THIRD_DATE,
  });
  const state = calendarRouteState({
    layers: [layer],
    items: [item],
    preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
  });
  await installCalendarRoutes(page, state);
  await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
  // No agenda canvas to hide any more — the calendar rail defaults to the Tasks panel, which has
  // no schedule region, so the all-day segments below are unambiguous without collapsing anything.

  const startSegment = allDaySegments(page, item.id).first();
  const endSegment = allDaySegments(page, item.id).last();
  const initialMoveControl = startSegment.getByRole('button', { name: `Move ${item.title}` });
  await expect(initialMoveControl).toBeVisible();
  expect(
    await startSegment
      .getByRole('button', { name: item.title, exact: true })
      .evaluate((element) => getComputedStyle(element).touchAction),
  ).toBe('none');
  expect(
    await initialMoveControl.evaluate((element) => getComputedStyle(element).touchAction),
  ).toBe('none');
  await expect(
    startSegment.getByRole('button', { name: `Resize ${item.title} from start` }),
  ).toBeVisible();
  await expect(
    endSegment.getByRole('button', { name: `Resize ${item.title} from end` }),
  ).toBeVisible();

  await dragAllDayControlToDate(
    page,
    endSegment.getByRole('button', { name: `Resize ${item.title} from end` }),
    ANCHOR_DATE,
    0.98,
  );
  await expect.poll(() => state.itemPatches.length).toBe(1);
  expect(state.itemPatches[0]).toEqual({
    itemId: item.id,
    patch: { allDayStartDate: ANCHOR_DATE, allDayEndDate: NEXT_DATE },
  });

  const resizedStartSegment = allDaySegments(page, item.id).first();
  const moveControl = resizedStartSegment.getByRole('button', { name: `Move ${item.title}` });
  await moveControl.focus();
  await moveControl.press('ArrowRight');
  await expect.poll(() => state.itemPatches.length).toBe(2);
  expect(state.itemPatches[1]).toEqual({
    itemId: item.id,
    patch: { allDayStartDate: NEXT_DATE, allDayEndDate: THIRD_DATE },
  });

  await attachCalendarScreenshot(page, testInfo, 'fluid-all-day-move-and-resize');
});
