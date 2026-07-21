/** Native browser drag coverage for task links and directed calendar relationships. */
import { AgendaOut, CalendarItemId } from '@docket/types';

import { signUpAndOnboard } from './helpers/app';
import {
  CALENDAR_IDS,
  makeCalendarItem,
  makeCalendarLayer,
  utcAt,
} from './helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from './helpers/calendar-routes';
import { dragLocatorToLocator, scheduleItem } from './helpers/calendar-ui';
import { expect, test } from './helpers/fixtures';

const ANCHOR_DATE = '2026-07-13';
const SOURCE_EVENT_ID = CalendarItemId.parse('J8PV2AHRZ6ENW3BJS08FPX4CKT');
const TARGET_EVENT_ID = CalendarItemId.parse('K9PV2AHRZ6ENW3BJS08FPX4CKT');
const TIMEBOX_ID = CalendarItemId.parse('MAPV2AHRZ6ENW3BJS08FPX4CKT');

test.use({ timezoneId: 'UTC', video: 'on' });

test('drags an Agenda task into a timebox and a calendar event into another event', async ({
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
    agendaResponse: AgendaOut.parse({
      date: ANCHOR_DATE,
      entries: [
        {
          kind: 'task_timebox',
          taskId: CALENDAR_IDS.existingTask,
          organizationId: orgId,
          title: taskTitle,
          state: 'backlog',
          priority: 'high',
          startsAt: utcAt(ANCHOR_DATE, 9),
          endsAt: utcAt(ANCHOR_DATE, 9, 45),
        },
      ],
    }),
  });
  await installCalendarRoutes(page, state);
  await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

  // The calendar rail defaults to the Tasks panel now; switch to the Agenda panel via the
  // activity bar to reach its draggable agenda items.
  await page.getByRole('button', { name: 'Agenda' }).click();
  const agenda = page.getByRole('complementary', { name: 'Agenda' });
  const agendaTaskDrag = agenda.getByRole('button', {
    name: `Create relationship from ${taskTitle}`,
  });
  await expect(agendaTaskDrag).toBeVisible();
  await dragLocatorToLocator(page, agendaTaskDrag, scheduleItem(page, timebox.id).card);

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

  await scheduleItem(page, targetEvent.id).body.click();
  await expect.poll(() => state.relationGets).toContain(targetEvent.id);
  await expect(page.getByRole('dialog').getByText(sourceEvent.title)).toBeVisible();
});
