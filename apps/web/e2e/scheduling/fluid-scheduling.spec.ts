/** Browser-level zoom, region creation, and DST contracts for the fluid scheduling canvas. */
import type { Locator } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { CALENDAR_IDS, makeCalendarItem, makeCalendarLayer } from '../helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from '../helpers/calendar-routes';
import {
  attachCalendarScreenshot,
  dragScheduleRegion,
  dragScheduleResizeGrip,
  hasVisibleKeyboardFocus,
  renderedContrastRatio,
  scheduleItem,
  scheduleLane,
  scheduleViewport,
} from '../helpers/calendar-ui';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const ANCHOR_DATE = '2026-07-13';
const ANCHOR_TIME = `${ANCHOR_DATE}T17:00:00.000Z`;

/** Read the measured number of complete lanes, rejecting an unset geometry contract. */
async function measuredLaneCount(schedule: Locator): Promise<number> {
  return Number(await schedule.getAttribute('data-visible-lane-count'));
}

/** Summarize one range request in UTC date-window terms. */
function rangeSummary(request: string): {
  readonly start: number;
  readonly end: number;
  readonly dayCount: number;
} | null {
  const url = new URL(request);
  const start = Date.parse(url.searchParams.get('start') ?? '');
  const end = Date.parse(url.searchParams.get('end') ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    start,
    end,
    dayCount: (end - start) / 86_400_000,
  };
}

/** Return whether one geometry-derived request covers the date the user is viewing. */
function hasRangeCoveringDate(
  requests: readonly string[],
  expected: { readonly includesDate: string; readonly dayCount: number },
): boolean {
  const includedInstant = Date.parse(`${expected.includesDate}T00:00:00Z`);
  return requests.some((request) => {
    const summary = rangeSummary(request);
    return (
      summary?.dayCount === expected.dayCount &&
      summary.start <= includedInstant &&
      summary.end > includedInstant
    );
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
      includesDate: ANCHOR_DATE,
      dayCount: desktopLaneCount * 3,
    };
    await expect(schedule).toHaveAttribute('data-lane-count', String(desktopRange.dayCount));
    await expect.poll(() => hasRangeCoveringDate(state.rangeRequests, desktopRange)).toBe(true);
    await expect(schedule.getByRole('status')).toHaveText(
      'Nothing scheduled. Drag on the grid or choose New to plan time.',
    );
    expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
    const calendarHeading = page.locator('main#main-content h1');
    const newButton = page.getByRole('button', { name: 'New', exact: true });
    expect(await renderedContrastRatio(calendarHeading)).toBeGreaterThanOrEqual(4.5);
    expect(await hasVisibleKeyboardFocus(page, newButton)).toBe(true);
    await attachCalendarScreenshot(page, testInfo, 'calendar-desktop-light');
    await setColorScheme(page, 'dark');
    // The theme is `@media (prefers-color-scheme: dark)` and nothing else, so there is no class to
    // assert. Contrast holding at the dark palette is the real evidence the switch took.
    expect(await renderedContrastRatio(calendarHeading)).toBeGreaterThanOrEqual(4.5);
    await attachCalendarScreenshot(page, testInfo, 'calendar-desktop-dark');
    await setColorScheme(page, 'light');

    await page.setViewportSize({ width: 1920, height: 900 });
    await expect.poll(() => measuredLaneCount(schedule)).toBeGreaterThanOrEqual(desktopLaneCount);
    const expandedLaneCount = await measuredLaneCount(schedule);
    const expandedRange = {
      includesDate: ANCHOR_DATE,
      dayCount: expandedLaneCount * 3,
    };
    await expect(schedule).toHaveAttribute('data-lane-count', String(expandedRange.dayCount));
    await expect.poll(() => hasRangeCoveringDate(state.rangeRequests, expandedRange)).toBe(true);

    // Zoom lives in exactly one place now: the Display menu. No preset button group, no `<select>`
    // duplicate of it, and — the goal doc's specific complaint — no slider exposed on the toolbar.
    const display = page.getByRole('button', { name: 'Display settings' });
    await expect(page.getByRole('slider')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Standard', exact: true })).toHaveCount(0);
    const laneHeight = async (): Promise<number> =>
      lane.evaluate((element) => Number.parseFloat(element.style.height));
    const chooseDensity = async (label: string): Promise<void> => {
      await display.click();
      await page.getByRole('menuitemradio', { name: label }).click();
      await expect(page.getByRole('menu')).toHaveCount(0);
    };

    await chooseDensity('Compact');
    await expect(schedule).toHaveAttribute('data-snap-minutes', '10');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(48);
    expect(await laneHeight()).toBe(24 * 48);
    await expect(schedule.locator('[data-schedule-label="60"]')).toContainText('1:00');

    await chooseDensity('Spacious');
    await expect(schedule).toHaveAttribute('data-snap-minutes', '5');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(108);
    expect(await laneHeight()).toBe(24 * 108);
    await expect(schedule.locator('[data-schedule-label="30"]')).toContainText('12:30');

    await chooseDensity('Default');
    await expect(schedule).toHaveAttribute('data-snap-minutes', '10');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(72);
    expect(await laneHeight()).toBe(24 * 72);

    // The compact stepper: an arbitrary value between presets is a legal state, reported as a
    // quiet "Custom" hint rather than as a fourth thing to pick.
    await display.click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByText('Custom · 125%')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(90);
    expect(await laneHeight()).toBe(24 * 90);

    // Stepping down clamps honestly: the control disables itself at the floor rather than
    // pretending a press did something.
    await display.click();
    await page.getByRole('menuitem', { name: 'Reset to default' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(72);
    expect(await laneHeight()).toBe(24 * 72);

    // Both clamps disable their own control rather than pretending a press did something.
    const stepToBound = async (name: 'Zoom in' | 'Zoom out'): Promise<void> => {
      await display.click();
      const step = page.getByRole('button', { name });
      for (let press = 0; press < 20 && !(await step.isDisabled()); press += 1) await step.click();
      await expect(step).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
    };

    await stepToBound('Zoom out');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(24);
    expect(await laneHeight()).toBe(24 * 24);

    await stepToBound('Zoom in');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(240);
    await expect(schedule).toHaveAttribute('data-snap-minutes', '5');
    expect(await laneHeight()).toBe(24 * 240);

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
    const createDialog = page.getByRole('dialog', { name: 'Create calendar item' });
    await expect(createDialog).toBeVisible();
    const typeGroup = createDialog.getByRole('group', { name: 'Calendar item type' });
    await expect(typeGroup.getByRole('button', { name: 'timebox' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await createDialog.getByRole('button', { name: /Edit schedule/ }).click();
    await expect(createDialog.getByRole('button', { name: /^Start date/ })).toContainText(
      'Jul 13, 2026',
    );
    await expect(createDialog.getByLabel('Start time')).toHaveValue('10:00');
    await expect(createDialog.getByLabel('End time')).toHaveValue('11:30');
    await createDialog.getByLabel('Title').fill('Deep work window');
    await createDialog.getByRole('button', { name: 'Save' }).click();

    await expect.poll(() => state.itemCreates.length).toBe(1);
    await expect(committedSelection).toHaveCount(0);
    await expect(createDialog).toHaveCount(0);
    expect(state.itemCreates[0]).toEqual({
      intent: 'timebox',
      title: 'Deep work window',
      startsAt: `${ANCHOR_DATE}T10:00:00Z`,
      endsAt: `${ANCHOR_DATE}T11:30:00Z`,
      timezone: 'UTC',
    });
    const createdItem = state.items.at(-1);
    if (!createdItem) throw new Error('The selected timebox was not added to fixture state.');
    const createdBody = scheduleItem(page, createdItem.id).body;
    await expect(createdBody).toContainText('Deep work window');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(schedule).toBeVisible();
    await expect.poll(() => measuredLaneCount(schedule)).toBeGreaterThan(0);
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    // On a phone the same one Display menu is still the only zoom control — there is no separate
    // narrow-width `<select>` duplicate of it any more.
    await expect(page.getByRole('combobox', { name: /zoom/i })).toHaveCount(0);
    await chooseDensity('Spacious');
    await expect.poll(() => state.preferencePatches.at(-1)?.calendar?.pixelsPerHour).toBe(108);

    // The row never wraps at 390px, and every control in it keeps a real touch target.
    const rowControls = [
      page.getByRole('button', { name: 'Today', exact: true }),
      page.getByRole('button', { name: 'Calendars' }),
      display,
      page.getByRole('button', { name: 'New', exact: true }),
    ];
    for (const control of rowControls) {
      await expect
        .poll(async () => (await control.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(40);
    }
    const rowTops = await Promise.all(
      rowControls.map(async (control) => (await control.boundingBox())?.y ?? -1),
    );
    // Inline neighbours share one row and one height — the old toolbar stacked into four rows here.
    expect(Math.max(...rowTops) - Math.min(...rowTops)).toBeLessThanOrEqual(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await createdBody.scrollIntoViewIfNeeded();
    await expect(createdBody).toBeVisible();
    await attachCalendarScreenshot(page, testInfo, 'calendar-narrow-light');
    await setColorScheme(page, 'dark');
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
    // Keep "now" beside each transition. The product can then exercise its real initial-scroll
    // behavior without the test fighting that behavior through direct scrollTop assignments.
    await page.clock.setFixedTime('2026-03-08T09:30:00.000Z');
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

    await page.clock.setFixedTime('2026-11-01T08:30:00.000Z');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(scheduleLane(page, '2026-11-01')).toBeVisible();
    const fallSchedule = scheduleViewport(page);
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

    const createDialog = page.getByRole('dialog', { name: 'Create calendar item' });
    await expect(createDialog.getByRole('group', { name: 'Calendar item type' })).toBeVisible();
    await createDialog.getByRole('button', { name: /Edit schedule/ }).click();
    await expect(createDialog.getByLabel('Start time')).not.toHaveValue(
      await createDialog.getByLabel('End time').inputValue(),
    );
  });
});
