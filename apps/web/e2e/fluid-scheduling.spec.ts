/** Browser-level zoom, region creation, and DST contracts for the fluid scheduling canvas. */
import type { Locator } from '@playwright/test';

import { signUpAndOnboard } from './helpers/app';
import {
  CALENDAR_IDS,
  makeCalendarItem,
  makeCalendarLayer,
  shiftDate,
} from './helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from './helpers/calendar-routes';
import {
  attachCalendarScreenshot,
  dragScheduleRegion,
  dragScheduleResizeGrip,
  hasVisibleKeyboardFocus,
  renderedContrastRatio,
  scheduleItem,
  scheduleLane,
  scheduleViewport,
} from './helpers/calendar-ui';
import { expect, test } from './helpers/fixtures';

const ANCHOR_DATE = '2026-07-13';
const ANCHOR_TIME = `${ANCHOR_DATE}T17:00:00.000Z`;

/** Read the measured number of complete lanes, rejecting an unset geometry contract. */
async function measuredLaneCount(schedule: Locator): Promise<number> {
  return Number(await schedule.getAttribute('data-visible-lane-count'));
}

/** Summarize one range request in UTC date-window terms. */
function rangeSummary(request: string): {
  readonly startDate: string;
  readonly dayCount: number;
} | null {
  const url = new URL(request);
  const start = Date.parse(url.searchParams.get('start') ?? '');
  const end = Date.parse(url.searchParams.get('end') ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    startDate: new Date(start).toISOString().slice(0, 10),
    dayCount: (end - start) / 86_400_000,
  };
}

/** Return whether the request journal contains the geometry-derived active window. */
function hasRangeSummary(
  requests: readonly string[],
  expected: { readonly startDate: string; readonly dayCount: number },
): boolean {
  return requests.some((request) => {
    const summary = rangeSummary(request);
    return summary?.startDate === expected.startDate && summary.dayCount === expected.dayCount;
  });
}

test.use({ timezoneId: 'UTC', video: 'on' });

test.describe('fluid scheduling interaction contract', () => {
  test('keeps a bounded rolling canvas, persists every zoom form, and creates a selected timebox', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(ANCHOR_TIME);
    await signUpAndOnboard(page, 'FluidZoomCreate');
    const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
    const state = calendarRouteState({
      layers: [layer],
      items: [],
      preferences: {
        timezone: 'UTC',
        calendar: {
          pixelsPerHour: 72,
          minLaneWidth: 240,
          defaultCreateIntent: 'timebox',
        },
      },
    });
    await installCalendarRoutes(page, state);
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

    const schedule = scheduleViewport(page);
    const lane = scheduleLane(page, ANCHOR_DATE);
    await expect(lane).toBeVisible();
    await expect(schedule).toHaveAttribute('data-snap-minutes', '10');
    await expect
      .poll(async () => schedule.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await expect
      .poll(async () => schedule.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    await expect.poll(() => measuredLaneCount(schedule)).toBeGreaterThanOrEqual(2);
    const desktopLaneCount = await measuredLaneCount(schedule);
    const desktopRange = {
      startDate: shiftDate(ANCHOR_DATE, -desktopLaneCount),
      dayCount: desktopLaneCount * 3,
    };
    await expect(schedule).toHaveAttribute('data-lane-count', String(desktopRange.dayCount));
    await expect.poll(() => hasRangeSummary(state.rangeRequests, desktopRange)).toBe(true);
    await expect(schedule.getByRole('status')).toHaveText(
      'Nothing scheduled. Drag on the grid or choose New to plan time.',
    );
    expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    const calendarHeading = page.locator('main#main-content h1');
    const newButton = page.getByRole('button', { name: 'New', exact: true });
    expect(await renderedContrastRatio(calendarHeading)).toBeGreaterThanOrEqual(4.5);
    expect(await hasVisibleKeyboardFocus(page, newButton)).toBe(true);
    await attachCalendarScreenshot(page, testInfo, 'calendar-desktop-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    expect(await renderedContrastRatio(calendarHeading)).toBeGreaterThanOrEqual(4.5);
    await attachCalendarScreenshot(page, testInfo, 'calendar-desktop-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });

    await page.setViewportSize({ width: 1920, height: 900 });
    await expect.poll(() => measuredLaneCount(schedule)).toBeGreaterThan(desktopLaneCount);
    const expandedLaneCount = await measuredLaneCount(schedule);
    const expandedRange = {
      startDate: shiftDate(ANCHOR_DATE, -expandedLaneCount),
      dayCount: expandedLaneCount * 3,
    };
    await expect(schedule).toHaveAttribute('data-lane-count', String(expandedRange.dayCount));
    await expect.poll(() => hasRangeSummary(state.rangeRequests, expandedRange)).toBe(true);

    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(schedule).toHaveAttribute('data-snap-minutes', '30');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(24);
    expect(await lane.evaluate((element) => Number.parseFloat(element.style.height))).toBe(576);
    await expect(schedule.locator('[data-schedule-label="120"]')).toContainText('2:00');
    await expect(schedule.locator('[data-schedule-label="60"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Standard', exact: true }).click();
    await expect(schedule).toHaveAttribute('data-snap-minutes', '10');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(72);
    expect(await lane.evaluate((element) => Number.parseFloat(element.style.height))).toBe(1728);
    await expect(schedule.locator('[data-schedule-label="60"]')).toContainText('1:00');

    await page.getByRole('button', { name: 'Detail', exact: true }).click();
    await expect(schedule).toHaveAttribute('data-snap-minutes', '5');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(144);
    expect(await lane.evaluate((element) => Number.parseFloat(element.style.height))).toBe(3456);
    await expect(schedule.locator('[data-schedule-label="30"]')).toContainText('12:30');

    const slider = page.getByRole('slider', { name: 'Calendar zoom' });
    await slider.focus();
    await slider.press('Home');
    for (let value = 24; value < 97; value += 1) await slider.press('ArrowRight');
    await expect(slider).toHaveValue('97');
    await slider.blur();
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(97);
    await expect(schedule).toHaveAttribute('data-snap-minutes', '5');
    expect(await lane.evaluate((element) => Number.parseFloat(element.style.height))).toBe(2328);
    await expect(page.getByRole('button', { name: 'Detail' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await slider.focus();
    await slider.press('End');
    await slider.blur();
    await expect(slider).toHaveValue('240');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(240);
    await expect(schedule).toHaveAttribute('data-snap-minutes', '5');
    expect(await lane.evaluate((element) => Number.parseFloat(element.style.height))).toBe(5760);

    await schedule.evaluate((element) => {
      element.scrollTop = (10 * 60 * 240) / 60 - element.clientHeight / 2;
    });
    await dragScheduleRegion(page, ANCHOR_DATE, 10 * 60, 11 * 60 + 30, 240);
    const committedSelection = schedule.locator(
      `[data-schedule-region-selection="date:${ANCHOR_DATE}"]`,
    );
    await expect(committedSelection).toBeVisible();
    await expect(committedSelection).toHaveAttribute('data-start-minutes', '600');
    await expect(committedSelection).toHaveAttribute('data-end-minutes', '690');
    const createDialog = page.getByRole('dialog');
    await expect(createDialog).toBeVisible();
    await expect
      .poll(() =>
        createDialog.evaluate((element) =>
          Number.parseFloat(
            getComputedStyle(element).getPropertyValue('--radix-popover-trigger-height'),
          ),
        ),
      )
      .toBeGreaterThan(300);
    const typeGroup = page.getByRole('group', { name: 'Calendar item type' });
    await expect(typeGroup.getByRole('button', { name: 'timebox' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByLabel('Starts')).toHaveValue(`${ANCHOR_DATE}T10:00`);
    await expect(page.getByLabel('Ends')).toHaveValue(`${ANCHOR_DATE}T11:30`);
    await page.getByLabel('Title').fill('Deep work window');
    await page.getByRole('button', { name: 'Create timebox' }).click();

    await expect.poll(() => state.itemCreates.length).toBe(1);
    await expect(committedSelection).toHaveCount(0);
    await expect(createDialog).toHaveCount(0);
    expect(state.itemCreates[0]).toEqual({
      intent: 'timebox',
      title: 'Deep work window',
      startsAt: `${ANCHOR_DATE}T10:00:00Z`,
      endsAt: `${ANCHOR_DATE}T11:30:00Z`,
    });
    const createdItem = state.items.at(-1);
    if (!createdItem) throw new Error('The selected timebox was not added to fixture state.');
    const createdBody = scheduleItem(page, createdItem.id).body;
    await expect(createdBody).toContainText('Deep work window');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(schedule).toBeVisible();
    await expect.poll(() => measuredLaneCount(schedule)).toBe(1);
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    const narrowPreset = page.getByRole('combobox', { name: 'Calendar zoom preset' });
    await narrowPreset.selectOption('144');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(144);
    for (const control of [
      page.getByRole('button', { name: 'Today', exact: true }),
      page.getByRole('button', { name: 'dates', exact: true }),
      narrowPreset,
      page.getByRole('button', { name: 'New', exact: true }),
      page.getByRole('slider', { name: 'Calendar zoom' }),
    ]) {
      await expect
        .poll(async () => (await control.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(40);
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await createdBody.scrollIntoViewIfNeeded();
    await expect(createdBody).toBeVisible();
    await attachCalendarScreenshot(page, testInfo, 'calendar-narrow-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await attachCalendarScreenshot(page, testInfo, 'calendar-narrow-dark');
    await page.setViewportSize({ width: 320, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });

  test('marks DST gaps and folds while rejecting a selection that starts in a skipped time', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.clock.setFixedTime('2026-03-08T17:00:00.000Z');
    await signUpAndOnboard(page, 'FluidDst');
    const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
    const springItem = makeCalendarItem({
      id: CALENDAR_IDS.writableEvent,
      title: 'Spring transition review',
      startsAt: '2026-03-08T09:30:00Z',
      endsAt: '2026-03-08T10:30:00Z',
    });
    const fallItem = makeCalendarItem({
      id: CALENDAR_IDS.existingNativeItem,
      title: 'Fall transition review',
      startsAt: '2026-11-01T07:30:00Z',
      endsAt: '2026-11-01T09:30:00Z',
    });
    const state = calendarRouteState({
      layers: [layer],
      items: [springItem, fallItem],
      preferences: {
        timezone: 'America/Los_Angeles',
        calendar: { pixelsPerHour: 144, defaultCreateIntent: 'timebox' },
      },
    });
    await installCalendarRoutes(page, state);
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

    const schedule = scheduleViewport(page);
    await expect(scheduleLane(page, '2026-03-08')).toBeVisible();
    await schedule.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect.poll(() => schedule.evaluate((element) => element.scrollTop)).toBe(0);
    const skippedBand = schedule.locator(
      '[data-schedule-transition="skipped"][data-schedule-transition-lane="date:2026-03-08"]',
    );
    await expect(skippedBand).toBeVisible();
    await expect(skippedBand).toContainText('Skipped hour · DST');
    await expect(schedule.locator('[data-schedule-label="150"]')).toContainText('2:30 AM');
    await attachCalendarScreenshot(page, testInfo, 'calendar-dst-spring-skipped-hour');
    await dragScheduleRegion(page, '2026-03-08', 150, 180, 144);
    await expect(page.getByRole('group', { name: 'Calendar item type' })).toHaveCount(0);
    await dragScheduleResizeGrip(page, springItem.id, 'end', 72);
    await expect.poll(() => state.itemPatches.length).toBe(1);
    expect(state.itemPatches[0]).toEqual({
      itemId: springItem.id,
      patch: {
        startsAt: '2026-03-08T09:30:00Z',
        endsAt: '2026-03-08T11:00:00Z',
      },
    });

    await page.clock.setFixedTime('2026-11-01T17:00:00.000Z');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(scheduleLane(page, '2026-11-01')).toBeVisible();
    const fallSchedule = scheduleViewport(page);
    // After a reload the canvas performs a one-time auto-scroll to "now" once its ResizeObserver
    // measures the viewport, which fires asynchronously and overrides a single reset. Re-assert
    // scrollTop = 0 on every poll iteration until it sticks (once the auto-scroll has run, the
    // reset holds) so the early-morning DST band is in view regardless of when it fires. This was
    // an intermittent DST-block flake.
    await expect
      .poll(async () => {
        await fallSchedule.evaluate((element) => {
          element.scrollTop = 0;
        });
        return fallSchedule.evaluate((element) => element.scrollTop);
      })
      .toBe(0);
    const repeatedBand = fallSchedule.locator(
      '[data-schedule-transition="repeated"][data-schedule-transition-lane="date:2026-11-01"]',
    );
    await expect(repeatedBand).toBeVisible();
    await expect(repeatedBand).toContainText('Repeated hour · DST');
    await dragScheduleResizeGrip(page, fallItem.id, 'end', 36);
    await expect.poll(() => state.itemPatches.length).toBe(2);
    expect(state.itemPatches[1]).toEqual({
      itemId: fallItem.id,
      patch: {
        startsAt: '2026-11-01T07:30:00Z',
        endsAt: '2026-11-01T10:45:00Z',
      },
    });
    await attachCalendarScreenshot(page, testInfo, 'calendar-dst-fall-repeated-hour');
  });
});

test.describe('touch scheduling interaction contract', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('pans normally and creates only after a deliberate long press', async ({ page }) => {
    await page.clock.setFixedTime(ANCHOR_TIME);
    await signUpAndOnboard(page, 'FluidTouch');
    const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
    const shortTouchItem = makeCalendarItem({
      id: CALENDAR_IDS.writableEvent,
      title: 'Five minute touch target',
      startsAt: `${ANCHOR_DATE}T09:00:00Z`,
      endsAt: `${ANCHOR_DATE}T09:05:00Z`,
    });
    const state = calendarRouteState({
      layers: [layer],
      items: [shortTouchItem],
      preferences: {
        timezone: 'UTC',
        calendar: { pixelsPerHour: 72, minLaneWidth: 240, defaultCreateIntent: 'timebox' },
      },
    });
    await installCalendarRoutes(page, state);
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

    const schedule = scheduleViewport(page);
    const lane = scheduleLane(page, ANCHOR_DATE);
    await expect(lane).toBeVisible();
    await expect(scheduleItem(page, shortTouchItem.id).card).toHaveCSS('height', '40px');
    const [scheduleBox, laneBox] = await Promise.all([schedule.boundingBox(), lane.boundingBox()]);
    if (!scheduleBox || !laneBox) throw new Error('Touch schedule has no browser geometry.');
    const x = laneBox.x + Math.min(laneBox.width - 12, laneBox.width / 2);
    const startY = scheduleBox.y + scheduleBox.height * 0.7;
    const session = await page.context().newCDPSession(page);
    const touch = async (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      y?: number,
    ): Promise<void> => {
      await session.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: y === undefined ? [] : [{ x, y, id: 1, force: 1 }],
      });
    };

    await schedule.evaluate((element) => {
      element.scrollTop = 700;
    });
    await expect.poll(() => schedule.evaluate((element) => element.scrollTop)).toBe(700);
    const initialScrollTop = await schedule.evaluate((element) => element.scrollTop);
    await touch('touchStart', startY);
    for (const offset of [40, 80, 120, 160]) {
      await touch('touchMove', startY - offset);
      await page.waitForTimeout(20);
    }
    await touch('touchEnd');
    await expect
      .poll(() => schedule.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(initialScrollTop + 100);
    await expect(schedule.locator('[data-schedule-region-preview]')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Calendar item type' })).toHaveCount(0);

    await touch('touchStart', startY);
    await page.waitForTimeout(400);
    await expect(schedule.locator('[data-schedule-region-preview]')).toBeVisible();
    await touch('touchMove', startY + 72);
    await touch('touchEnd');

    await expect(page.getByRole('group', { name: 'Calendar item type' })).toBeVisible();
    await expect(page.getByLabel('Starts')).not.toHaveValue(
      await page.getByLabel('Ends').inputValue(),
    );
  });
});
