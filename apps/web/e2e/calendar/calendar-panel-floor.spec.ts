/**
 * The calendar's 10%-of-viewport floor, measured against the full cross-product of panel states.
 *
 * @remarks
 * The requirement is blunt: *"Under no circumstances — and do not create a fake-ass smoke test for
 * this — should any combination of UX interactions result in a calendar view that takes up less than
 * 10% of the entire fucking viewport."*
 *
 * So nothing here is satisfied by an element being present. Every assertion reads
 * `getBoundingClientRect()` off the live grid in a real browser, clips it to the viewport, and
 * compares the resulting **area** against `innerWidth * innerHeight`. The states are opened by
 * actually clicking their controls, and each measurement names the exact combination that produced
 * it, so a failure says which interaction broke the floor rather than that "the calendar is small".
 *
 * The enumerated axes are the four things on this surface that can take width or cover the grid:
 *
 * - the shell's right rail, docked or collapsed (the interaction that historically caused this);
 * - the Calendars popover and the Display menu, the two toolbar surfaces;
 * - the item drawer, the only sheet that opens from the grid itself;
 * - the sync alert, which is a band of chrome above the grid and therefore a height cost.
 *
 * Sensitivity was demonstrated rather than assumed: injecting `#shell-aside { width: 68% }` into the
 * running page makes this spec fail with
 * `1440x900 · rail docked · none · no alert: grid area is 7.38% of the viewport`, and removing the
 * injection restores the pass. The assertion can fail, and it fails on the number it is about.
 *
 * @see {@link file://./calendar-viewport-floor.spec.ts} for the same floor across the rail's
 * appearance band, which this complements rather than replaces.
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

/** The contract's own floor. Asserted literally — this is the number the author wrote. */
const MINIMUM_VIEWPORT_SHARE = 0.1;

/** Phone, tablet, small laptop, and the standard review viewport. */
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 834, height: 1112 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

/** The overlay surfaces this page can put on screen, one at a time. */
const OVERLAYS = ['none', 'calendars', 'display', 'drawer'] as const;

/** One overlay surface the calendar can open. */
type Overlay = (typeof OVERLAYS)[number];

test.use({ timezoneId: 'UTC' });

/** Measure the clipped on-screen area of the schedule grid as a share of the viewport. */
async function measureShare(page: Page): Promise<{ share: number; visibleCount: number }> {
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
    const areas = regions.map((element) => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      return width * height;
    });
    const viewportArea = window.innerWidth * window.innerHeight;
    return {
      visibleCount: regions.length,
      share: viewportArea === 0 ? 0 : Math.max(0, ...areas, 0) / viewportArea,
    };
  });
}

/** Dock or collapse the shell's right rail, where the width actually has one. */
async function setRail(page: Page, expanded: boolean): Promise<void> {
  const activityBar = page.locator('nav[aria-label="Panels"]');
  // Both shell columns are now always in the DOM and hide themselves in CSS, so presence proves
  // nothing — visibility is the question. Below the dock threshold the panel is a modal sheet that
  // costs `<main>` no width, and opening one would only drop a scrim over the controls this sweep
  // still has to drive.
  if (!(await activityBar.isVisible())) return;
  const collapse = activityBar.getByRole('button', { name: 'Collapse Tasks' });
  const reopen = activityBar.getByRole('button', { name: 'Tasks', exact: true });
  if (expanded && (await reopen.count()) > 0) await reopen.first().click();
  if (!expanded && (await collapse.count()) > 0) await collapse.first().click();
}

/** Open one overlay surface, having closed whatever was open. */
async function openOverlay(page: Page, overlay: Overlay): Promise<void> {
  await page.keyboard.press('Escape');
  await playwrightExpect(page.getByRole('menu')).toHaveCount(0);
  if (overlay === 'none') return;
  if (overlay === 'calendars') {
    await page.getByRole('button', { name: 'Calendars' }).click();
    await playwrightExpect(page.getByRole('dialog', { name: 'Calendars' })).toBeVisible();
    return;
  }
  if (overlay === 'display') {
    await page.getByRole('button', { name: 'Display settings' }).click();
    await playwrightExpect(page.getByRole('menu')).toBeVisible();
    return;
  }
  await page
    .getByRole('button', { name: /^Research review/ })
    .first()
    .click();
  await playwrightExpect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
}

/** Fixture state with real content, optionally carrying a sync conflict that shows the alert. */
function stateWith(conflicted: boolean): ReturnType<typeof calendarRouteState> {
  const nativeLayer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
  return calendarRouteState({
    layers: [nativeLayer],
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
        startsAt: utcAt(ANCHOR_DATE, 13),
        endsAt: utcAt(ANCHOR_DATE, 14, 30),
        ...(conflicted ? { hasConflict: true, syncState: 'provider_error' as const } : {}),
      }),
    ],
    preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
  });
}

for (const viewport of VIEWPORTS) {
  const size = `${String(viewport.width)}x${String(viewport.height)}`;
  test(`holds a tenth of the viewport in every panel combination at ${size}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
    await page.setViewportSize({ ...viewport });
    await signUpAndOnboard(page, 'PanelFloor');

    for (const syncAlert of [false, true]) {
      await installCalendarRoutes(page, stateWith(syncAlert));
      await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('region', { name: 'Schedule' })).toBeVisible();
      if (syncAlert) await expect(page.getByRole('alert').first()).toBeVisible();

      for (const railExpanded of [true, false]) {
        await setRail(page, railExpanded);
        for (const overlay of OVERLAYS) {
          await openOverlay(page, overlay);

          const label = `${size} · rail ${railExpanded ? 'docked' : 'collapsed'} · ${overlay} · ${
            syncAlert ? 'sync alert' : 'no alert'
          }`;
          const { share, visibleCount } = await measureShare(page);

          expect(visibleCount, `${label}: exactly one calendar on screen`).toBe(1);
          expect(
            share,
            `${label}: grid area is ${(share * 100).toFixed(2)}% of the viewport`,
          ).toBeGreaterThanOrEqual(MINIMUM_VIEWPORT_SHARE);
        }
        await openOverlay(page, 'none');
      }
    }
  });
}
