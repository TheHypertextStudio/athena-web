/**
 * Native browser drag coverage for task links and directed calendar relationships.
 *
 * @remarks
 * Also the executable proof of the goal doc's "it must be possible to drag events into time
 * blocks": dropping an event card onto a timebox card creates a `contained` relation, while
 * dropping it onto an ordinary event creates a `related` one. The drag source for a task is the
 * calendar rail's Tasks day-plan — the calendar surface no longer registers the Agenda panel,
 * because that panel mounts a second scheduling canvas beside the calendar's own.
 */
import { CalendarItemId } from '@docket/types';

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

// The Tasks rail has to be docked beside the calendar for a cross-surface drag, which the shell
// only does at 90rem and up; below that the same panel is a modal overlay.
test.use({ timezoneId: 'UTC', video: 'on', viewport: { width: 1440, height: 900 } });

test('drags a task into a timebox and an event into another event and into a time block', async ({
  page,
}) => {
  await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
  const { orgId } = await signUpAndOnboard(page, 'FluidRelations');
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
  const taskTitle = 'Draft launch brief';
  const state = calendarRouteState({
    layers: [layer],
    items: [timebox, sourceEvent, targetEvent],
    preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
  });
  await installCalendarRoutes(page, state);
  // The calendar rail is the Tasks day-plan, fed by the cross-workspace hub.today plan.
  await page.route('**/v1/hub/today**', async (route) => {
    await route.fulfill({
      json: {
        date: ANCHOR_DATE,
        plan: [
          {
            id: CALENDAR_IDS.existingTask,
            organizationId: orgId,
            title: taskTitle,
            state: 'backlog',
            priority: 'high',
            assigneeId: null,
            projectId: null,
            dueDate: ANCHOR_DATE,
          },
        ],
        calendar: [],
        needsAttention: { inbox: 0, approvals: [], blocked: [], dueToday: [] },
      },
    });
  });
  await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

  // Exactly one scheduling canvas is on screen: the calendar's own. The Agenda panel is not
  // registered here at all, so there is no second time grid to drag from or into.
  await expect(page.locator('[aria-label="Schedule"]')).toHaveCount(1);

  const tasksPanel = page.getByRole('complementary', { name: 'Tasks' });
  const taskRow = tasksPanel.getByRole('link', { name: new RegExp(taskTitle) });
  await expect(taskRow).toBeVisible();
  await dragLocatorToLocator(page, taskRow, scheduleItem(page, timebox.id).card);

  await expect.poll(() => state.taskLinkPosts.length).toBe(1);
  expect(state.taskLinkPosts[0]).toEqual({
    itemId: timebox.id,
    input: {
      mode: 'link',
      taskId: CALENDAR_IDS.existingTask,
      organizationId: orgId,
      role: 'contained',
    },
  });

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
