/** Native browser drag coverage for scheduling a task by dropping it onto empty grid time. */
import { signUpAndOnboard } from './helpers/app';
import { CALENDAR_IDS, makeCalendarLayer } from './helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from './helpers/calendar-routes';
import { dragLocatorToLocator, scheduleLane } from './helpers/calendar-ui';
import { expect, test } from './helpers/fixtures';

const ANCHOR_DATE = '2026-07-13';

test.use({ timezoneId: 'UTC' });

test('schedules a task by dropping it from the Tasks rail onto the calendar grid', async ({
  page,
}) => {
  await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
  const { orgId } = await signUpAndOnboard(page, 'GridDrop');
  const taskTitle = 'Draft launch brief';
  const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
  const state = calendarRouteState({
    layers: [layer],
    items: [],
    preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
  });
  await installCalendarRoutes(page, state);
  // The calendar rail defaults to the Tasks panel, fed by the cross-workspace hub.today plan.
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

  const tasksPanel = page.getByRole('complementary', { name: 'Tasks' });
  const taskRow = tasksPanel.getByRole('link', { name: new RegExp(taskTitle) });
  await expect(taskRow).toBeVisible();

  // Drop the task onto empty grid time: it becomes a timebox titled after the task, with the task
  // linked into it — a create followed by a link, both against the shared calendar write path.
  await dragLocatorToLocator(page, taskRow, scheduleLane(page, ANCHOR_DATE));

  await expect.poll(() => state.itemCreates.length).toBe(1);
  const created = state.itemCreates[0];
  expect(created).toMatchObject({ intent: 'timebox', title: taskTitle });
  expect(created?.startsAt).toBeTruthy();
  expect(created?.endsAt).toBeTruthy();

  await expect.poll(() => state.taskLinkPosts.length).toBe(1);
  expect(state.taskLinkPosts[0]).toEqual({
    itemId: CALENDAR_IDS.createdNativeItem,
    input: {
      mode: 'link',
      taskId: CALENDAR_IDS.existingTask,
      organizationId: orgId,
      role: 'contained',
    },
  });
});
