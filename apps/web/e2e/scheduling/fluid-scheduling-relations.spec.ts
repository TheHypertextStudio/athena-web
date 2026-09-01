/** Native browser drag coverage for directed calendar-item relationships. */
import { CalendarItemId } from '@docket/planning/ids';

import { signUpAndOnboard } from '../helpers/app';
import {
  CALENDAR_IDS,
  makeCalendarItem,
  makeCalendarLayer,
  utcAt,
} from '../helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from '../helpers/calendar-routes';
import { dragLocatorToLocator, scheduleItem } from '../helpers/calendar-ui';
import { expect, test } from '../helpers/fixtures';

const ANCHOR_DATE = '2026-07-13';
const SOURCE_EVENT_ID = CalendarItemId.parse('J8PV2AHRZ6ENW3BJS08FPX4CKT');
const TARGET_EVENT_ID = CalendarItemId.parse('K9PV2AHRZ6ENW3BJS08FPX4CKT');
const TIMEBOX_ID = CalendarItemId.parse('MAPV2AHRZ6ENW3BJS08FPX4CKT');

test.use({ timezoneId: 'UTC' });

test('drags an event into another event and into a time block', async ({ page }) => {
  await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
  await signUpAndOnboard(page, 'FluidRelations');
  const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
  const timebox = makeCalendarItem({
    id: TIMEBOX_ID,
    layerId: layer.id,
    kind: 'timebox',
    title: 'Launch window',
    startsAt: utcAt(ANCHOR_DATE, 10),
    endsAt: utcAt(ANCHOR_DATE, 11),
  });
  const sourceEvent = makeCalendarItem({
    id: SOURCE_EVENT_ID,
    layerId: layer.id,
    kind: 'native_event',
    title: 'Research review',
    startsAt: utcAt(ANCHOR_DATE, 12),
    endsAt: utcAt(ANCHOR_DATE, 13),
  });
  const targetEvent = makeCalendarItem({
    id: TARGET_EVENT_ID,
    layerId: layer.id,
    kind: 'native_event',
    title: 'Decision meeting',
    startsAt: utcAt(ANCHOR_DATE, 13, 30),
    endsAt: utcAt(ANCHOR_DATE, 14, 30),
  });
  const state = calendarRouteState({
    layers: [layer],
    items: [timebox, sourceEvent, targetEvent],
    preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
  });
  await installCalendarRoutes(page, state);
  await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

  // Exactly one scheduling canvas is on screen: the calendar's own. The Agenda panel is not
  // registered here at all, so there is no second time grid to drag from or into.
  await expect(page.locator('[aria-label="Schedule"]')).toHaveCount(1);

  const main = page.locator('main#main-content');
  const eventDrag = main.getByRole('button', {
    name: `Create relationship from ${sourceEvent.title}`,
  });
  await expect(eventDrag).toBeVisible();
  await eventDrag.focus();
  await page.keyboard.press('Enter');
  const keyboardTarget = main.locator('[data-schedule-relationship-target]').first();
  await expect(keyboardTarget).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[data-schedule-relationship-covered][inert]')),
    ),
  ).toBe(false);
  await page.keyboard.press('Escape');

  await dragLocatorToLocator(page, eventDrag, scheduleItem(page, targetEvent.id).card);

  await expect.poll(() => state.relationPosts.length).toBe(1);
  expect(state.relationPosts[0]).toEqual({
    itemId: targetEvent.id,
    input: { targetItemId: sourceEvent.id, role: 'related' },
  });

  // Dropping the same event onto a *time block* means something stronger: the event is contained
  // by the block, not merely related to it.
  await dragLocatorToLocator(page, eventDrag, scheduleItem(page, timebox.id).card);

  await expect.poll(() => state.relationPosts.length).toBe(2);
  expect(state.relationPosts[1]).toEqual({
    itemId: timebox.id,
    input: { targetItemId: sourceEvent.id, role: 'contained' },
  });

  await scheduleItem(page, targetEvent.id).body.click();
  await expect.poll(() => state.relationGets).toContain(targetEvent.id);
  await expect(page.getByRole('dialog').getByText(sourceEvent.title)).toBeVisible();
});
