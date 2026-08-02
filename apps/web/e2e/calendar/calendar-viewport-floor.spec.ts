/**
 * The calendar's hard layout floor, measured in a real browser at real widths.
 *
 * @remarks
 * Three promises are enforced here, all of which the pre-rebuild layout broke:
 *
 * 1. **One calendar, ever.** Registering the Agenda beside the calendar's own timeline put two live
 *    scheduling canvases on screen, and at 1024x600 the rail's copy was roughly five times the size
 *    of the real one.
 * 2. **A floor of a tenth of the viewport.** The measured worst case was 5.55%, and 9.64% with no
 *    interaction at all. This asserts 20% so a regression is caught with margin rather than at the
 *    moment it becomes a bug.
 * 3. **No horizontal overflow at any width.**
 *
 * The width band is chosen deliberately: 960 → 1024 is where the shell's `lg` rail appears, and it
 * used to make the calendar *smaller* as the window got *wider* (41% → 9.6%). Every combination of
 * rail state and axis is measured, because the failure was never in one state — it was in the
 * interaction between them.
 */
import { expect as playwrightExpect, type Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import {
  CALENDAR_IDS,
  makeCalendarItem,
  makeCalendarLayer,
  utcAt,
} from '../helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from '../helpers/calendar-routes';
import { expect, test } from '../helpers/fixtures';

const ANCHOR_DATE = '2026-07-13';

/** The band where the shell's right rail appears and the old layout collapsed. */
const VIEWPORTS = [
  { width: 960, height: 640 },
  { width: 1024, height: 600 },
  { width: 1180, height: 620 },
  { width: 1280, height: 720 },
  { width: 1440, height: 760 },
] as const;

/** The contract is a tenth of the viewport; asserting a fifth leaves room to catch drift early. */
const MINIMUM_VIEWPORT_SHARE = 0.2;

test.use({ timezoneId: 'UTC' });

/** One measurement of the calendar's real, on-screen footprint. */
interface ScheduleFootprint {
  readonly visibleCount: number;
  readonly share: number;
  readonly overflows: boolean;
}

/** Measure the clipped area of every visible schedule region against the viewport. */
async function measureSchedule(page: Page): Promise<ScheduleFootprint> {
  return page.evaluate(() => {
    const regions = [...document.querySelectorAll('[aria-label="Schedule"]')].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    });
    const clipped = regions.map((element) => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      return width * height;
    });
    const viewportArea = window.innerWidth * window.innerHeight;
    const scrollingElement = document.scrollingElement;
    return {
      visibleCount: regions.length,
      share: viewportArea === 0 ? 0 : Math.max(0, ...clipped, 0) / viewportArea,
      overflows: (scrollingElement?.scrollWidth ?? 0) > window.innerWidth,
    };
  });
}

/** Put the shell's right rail into the requested state, tolerating widths that have no rail. */
async function setRail(page: Page, expanded: boolean): Promise<void> {
  const activityBar = page.locator('nav[aria-label="Panels"]');
  if ((await activityBar.count()) === 0) return;
  // Expanded/collapsed is only a *layout* state where the rail can dock. Below that threshold the
  // panel is a modal overlay that takes no width from `<main>`, so there is nothing to set here —
  // and opening one would just drop a scrim over the controls the rest of this sweep drives.
  if ((await page.locator('#shell-aside').count()) === 0) return;
  const collapse = activityBar.getByRole('button', { name: 'Collapse Tasks' });
  const reopen = activityBar.getByRole('button', { name: 'Tasks', exact: true });
  if (expanded && (await reopen.count()) > 0) await reopen.first().click();
  if (!expanded && (await collapse.count()) > 0) await collapse.first().click();
}

/** Switch the calendar between its Dates and People axes through the consolidated Display menu. */
async function setAxis(page: Page, axis: 'Dates' | 'People'): Promise<void> {
  const display = page.getByRole('button', { name: 'Display settings' });
  if ((await display.count()) > 0) {
    await display.first().click();
    await page.getByRole('menuitemradio', { name: axis }).click();
    await playwrightExpect(page.getByRole('menu')).toHaveCount(0);
    return;
  }
  await page.getByRole('button', { name: axis, exact: true }).click();
}

test('keeps exactly one schedule on screen, above its floor, at every width', async ({ page }) => {
  await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
  await signUpAndOnboard(page, 'ViewportFloor');

  // Real content, not an empty grid: two layers, overlapping events, an all-day item, and a
  // holiday-shaped provider layer so the dedup path has something to find.
  const nativeLayer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
  const holidayLayer = makeCalendarLayer({
    id: CALENDAR_IDS.googleReadOnlyLayer,
    connectionId: CALENDAR_IDS.googleConnection,
    provider: 'google',
    sourceKind: 'provider_calendar',
    externalLayerId: 'en.usa#holiday@group.v.calendar.google.com',
    title: 'Holidays in United States',
    color: '#b45309',
    editableCore: false,
  });
  const state = calendarRouteState({
    layers: [nativeLayer, holidayLayer],
    items: [
      makeCalendarItem({
        id: CALENDAR_IDS.existingNativeItem,
        layerId: nativeLayer.id,
        kind: 'timebox',
        title: 'Launch window',
        startsAt: utcAt(ANCHOR_DATE, 9),
        endsAt: utcAt(ANCHOR_DATE, 11),
      }),
      makeCalendarItem({
        id: CALENDAR_IDS.writableEvent,
        layerId: nativeLayer.id,
        kind: 'native_event',
        title: 'Research review',
        startsAt: utcAt(ANCHOR_DATE, 10),
        endsAt: utcAt(ANCHOR_DATE, 11, 30),
      }),
      makeCalendarItem({
        id: CALENDAR_IDS.conflictEvent,
        layerId: nativeLayer.id,
        kind: 'native_event',
        title: 'Decision meeting',
        startsAt: utcAt(ANCHOR_DATE, 10, 30),
        endsAt: utcAt(ANCHOR_DATE, 12),
      }),
      makeCalendarItem({
        id: CALENDAR_IDS.readOnlyEvent,
        layerId: holidayLayer.id,
        kind: 'provider_event',
        provider: 'google',
        title: 'Independence Day',
        startsAt: null,
        endsAt: null,
        allDayStartDate: ANCHOR_DATE,
        allDayEndDate: ANCHOR_DATE,
        permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
      }),
    ],
    preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
  });
  await installCalendarRoutes(page, state);

  await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Schedule' })).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ ...viewport });
    for (const railExpanded of [true, false]) {
      await setRail(page, railExpanded);
      for (const axis of ['Dates', 'People'] as const) {
        await setAxis(page, axis);
        await expect(page.getByRole('region', { name: 'Schedule' })).toBeVisible();

        const label = `${String(viewport.width)}x${String(viewport.height)} · rail ${
          railExpanded ? 'expanded' : 'collapsed'
        } · ${axis}`;
        const footprint = await measureSchedule(page);

        expect(footprint.visibleCount, `${label}: exactly one schedule on screen`).toBe(1);
        expect(
          footprint.share,
          `${label}: schedule occupies ${(footprint.share * 100).toFixed(1)}% of the viewport`,
        ).toBeGreaterThanOrEqual(MINIMUM_VIEWPORT_SHARE);
        expect(footprint.overflows, `${label}: no horizontal page overflow`).toBe(false);
      }
      await setAxis(page, 'Dates');
    }
  }
});
