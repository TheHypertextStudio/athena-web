/**
 * Visual evidence that a task can be dragged from the rail into a time block on the calendar.
 *
 * @remarks
 * `fluid-scheduling-grid-drop.spec.ts` already asserts the *write* side of this gesture (a create
 * plus a task link). What it does not do is show it, and a design review cannot score an interaction
 * it has only read about. This spec performs the same real HTML5 drag and attaches a before/after
 * pair plus a close-up of the resulting block, so the drop is verifiable by looking at it.
 */
import { signUpAndOnboard } from '../helpers/app';
import { CALENDAR_IDS, makeCalendarLayer } from '../helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from '../helpers/calendar-routes';
import { dragLocatorToLocator, scheduleLane } from '../helpers/calendar-ui';
import { expect, test } from '../helpers/fixtures';

const ANCHOR_DATE = '2026-07-13';

// The rail must be docked beside the grid for a cross-surface drag, which the shell does at 90rem.
test.use({ timezoneId: 'UTC', viewport: { width: 1440, height: 900 } });

test('drags a task from the rail into a time block, captured before and after', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
  const { orgId } = await signUpAndOnboard(page, 'DragEvidence');
  const taskTitle = 'Draft launch brief';
  const state = calendarRouteState({
    layers: [makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' })],
    items: [],
    preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
  });
  await installCalendarRoutes(page, state);
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
  // The grid and the drag source are on screen together — the precondition the gesture needs.
  await expect(page.getByRole('region', { name: 'Schedule' })).toBeVisible();
  const before = testInfo.outputPath('drag-1-before.png');
  await page.screenshot({ path: before });
  await testInfo.attach('drag-1-before.png', { path: before, contentType: 'image/png' });

  await dragLocatorToLocator(page, taskRow, scheduleLane(page, ANCHOR_DATE));

  // The drop created a timebox on the grid, titled after the task.
  await expect.poll(() => state.itemCreates.length).toBe(1);
  const block = page
    .getByRole('region', { name: 'Schedule' })
    .locator(`[data-schedule-item="${CALENDAR_IDS.createdNativeItem}"]`);
  await expect(block).toBeVisible();
  await expect(block).toContainText(taskTitle);

  const after = testInfo.outputPath('drag-2-after.png');
  await page.screenshot({ path: after });
  await testInfo.attach('drag-2-after.png', { path: after, contentType: 'image/png' });

  const closeUp = testInfo.outputPath('drag-3-block.png');
  await block.screenshot({ path: closeUp });
  await testInfo.attach('drag-3-block.png', { path: closeUp, contentType: 'image/png' });
});
