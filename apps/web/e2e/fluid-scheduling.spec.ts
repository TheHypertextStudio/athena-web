/** Browser-level zoom, region creation, and DST contracts for the fluid scheduling canvas. */
import type { Locator } from '@playwright/test';

import { signUpAndOnboard } from './helpers/app';
import { CALENDAR_IDS, makeCalendarLayer, shiftDate } from './helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from './helpers/calendar-routes';
import {
  attachCalendarScreenshot,
  dragScheduleRegion,
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

    await expect.poll(() => measuredLaneCount(schedule)).toBeGreaterThan(0);
    const desktopLaneCount = await measuredLaneCount(schedule);
    const desktopRange = {
      startDate: shiftDate(ANCHOR_DATE, -desktopLaneCount),
      dayCount: desktopLaneCount * 3,
    };
    await expect(schedule).toHaveAttribute('data-lane-count', String(desktopRange.dayCount));
    await expect.poll(() => hasRangeSummary(state.rangeRequests, desktopRange)).toBe(true);
    expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await attachCalendarScreenshot(page, testInfo, 'calendar-desktop-light');

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
    expect(state.itemCreates[0]).toEqual({
      intent: 'timebox',
      title: 'Deep work window',
      startsAt: `${ANCHOR_DATE}T10:00:00Z`,
      endsAt: `${ANCHOR_DATE}T11:30:00Z`,
    });
    const createdItem = state.items.at(-1);
    if (!createdItem) throw new Error('The selected timebox was not added to fixture state.');
    await expect(scheduleItem(page, createdItem.id).body).toContainText('Deep work window');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await expect(schedule).toBeVisible();
    await expect.poll(() => measuredLaneCount(schedule)).toBe(1);
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await attachCalendarScreenshot(page, testInfo, 'calendar-narrow-dark');
  });

  test('marks DST gaps and folds while rejecting a selection that starts in a skipped time', async ({
    page,
  }, testInfo) => {
    await page.clock.setFixedTime('2026-03-08T17:00:00.000Z');
    await signUpAndOnboard(page, 'FluidDst');
    const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
    const state = calendarRouteState({
      layers: [layer],
      items: [],
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

    await page.clock.setFixedTime('2026-11-01T17:00:00.000Z');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(scheduleLane(page, '2026-11-01')).toBeVisible();
    const fallSchedule = scheduleViewport(page);
    await fallSchedule.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect.poll(() => fallSchedule.evaluate((element) => element.scrollTop)).toBe(0);
    const repeatedBand = fallSchedule.locator(
      '[data-schedule-transition="repeated"][data-schedule-transition-lane="date:2026-11-01"]',
    );
    await expect(repeatedBand).toBeVisible();
    await expect(repeatedBand).toContainText('Repeated hour · DST');
    await attachCalendarScreenshot(page, testInfo, 'calendar-dst-fall-repeated-hour');
  });
});
