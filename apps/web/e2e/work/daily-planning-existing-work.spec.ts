import { addDays, instantAt } from '@docket/planning/zoned-time';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { signUpAndOnboard } from '../helpers/app';
import {
  captureDailyPlanningEvidence,
  openPlan,
  saveDraft,
  setupPlan,
  showPlanningPanel,
  snapshot,
  type DayRead,
} from '../helpers/daily-planning';

test('opens a fixed calendar event from the planning agenda', async ({ page }) => {
  const context = await setupPlan(page, 'planning-event', [], 1);
  const event = await apiJson<{ id: string }>(page, '/v1/me/calendar/items', {
    method: 'POST',
    body: {
      intent: 'event',
      title: 'Community planning meeting',
      timezone: context.timezone,
      startsAt: instantAt(context.date, 600, context.timezone).toISOString(),
      endsAt: instantAt(context.date, 660, context.timezone).toISOString(),
    },
  });
  await openPlan(page, context.date);
  await page.locator(`[data-schedule-item="event:${event.id}"]`).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Community planning meeting');
});

test('opens with existing work already selected and scheduled', async ({ page }, testInfo) => {
  const context = await setupPlan(page, 'planning-auto-created-work', [], 1);
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${context.orgId}/teams`);
  const created = await apiJson<{ id: string }>(page, `/v1/orgs/${context.orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Prepare community meeting', teamId: teams.items[0]?.id, estimateMinutes: 60 },
  });
  await apiJson(page, `/v1/orgs/${context.orgId}/tasks/${created.id}`, {
    method: 'PATCH',
    body: { assigneeId: null },
  });

  await openPlan(page, context.date);
  await showPlanningPanel(page, 'Work');
  const selected = page.getByRole('region', { name: 'Selected work', exact: true });
  await expect(selected.getByText('Prepare community meeting', { exact: true })).toBeVisible();
  await expect(selected.getByText('Existing backlog work', { exact: true })).toBeVisible();
  await expect(
    selected.getByRole('spinbutton', { name: 'Planned time for Prepare community meeting' }),
  ).toHaveValue('60');
  await captureDailyPlanningEvidence(page, testInfo, 'plan-tomorrow');
  await expect
    .poll(async () => {
      const saved = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
      return saved.draft?.tasks.some((task) => task.taskId === created.id);
    })
    .toBe(true);
  await showPlanningPanel(page, 'Agenda');
  const block = page
    .locator('[data-schedule-item]')
    .filter({ hasText: 'Prepare community meeting' })
    .first();
  await expect(block).toBeVisible();
  await block.click();
  await expect(page.getByRole('dialog', { name: 'Edit block' })).toBeVisible();
  await expect(
    page.getByRole('spinbutton', { name: 'Duration for Prepare community meeting' }),
  ).toHaveValue('60');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('can add and reschedule work intentionally left out of the proposed day', async ({ page }) => {
  const context = await setupPlan(page, 'planning-existing', [], 1);
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${context.orgId}/teams`);
  const created = await apiJson<{ id: string }>(page, `/v1/orgs/${context.orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Prepare community meeting', teamId: teams.items[0]?.id, estimateMinutes: 60 },
  });
  await saveDraft(page, {
    date: context.date,
    finishAt: instantAt(context.date, 17 * 60, context.timezone).toISOString(),
    mainTaskId: null,
    tasks: [],
    sessions: [],
    settings: {
      startAt: instantAt(context.date, 9 * 60, context.timezone).toISOString(),
      excludedTaskIds: [created.id],
    },
  });
  await openPlan(page, context.date);
  await showPlanningPanel(page, 'Work');
  const available = page.getByRole('region', { name: 'Existing tasks' });
  await expect(available.getByText('Prepare community meeting', { exact: true })).toBeVisible();
  await available
    .getByRole('button', { name: 'Add Prepare community meeting', exact: true })
    .click();
  await expect(
    page.getByRole('spinbutton', { name: 'Planned time for Prepare community meeting' }),
  ).toHaveValue('60');
  await showPlanningPanel(page, 'Agenda');
  await page.getByRole('button', { name: 'Schedule work', exact: true }).click();
  await page.getByLabel('Task to schedule').selectOption(created.id);
  await page.getByLabel('Start time', { exact: true }).fill('10:00');
  await page.getByRole('button', { name: 'Save block', exact: true }).click();
  const block = page
    .locator('[data-schedule-item]')
    .filter({ hasText: 'Prepare community meeting' })
    .first();
  await block.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Start', { exact: true }).fill('11:00');
  await page.getByRole('button', { name: 'Save block', exact: true }).click();
  await expect
    .poll(async () => {
      const day = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
      return day.draft?.sessions[0]?.startsAt;
    })
    .toBe(instantAt(context.date, 11 * 60, context.timezone).toISOString());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await showPlanningPanel(page, 'Agenda');
  await expect(
    page.locator('[data-schedule-item]').filter({ hasText: 'Prepare community meeting' }).first(),
  ).toBeVisible();
});

test('pointer input reaches a scheduled block beneath the task drop target', async ({ page }) => {
  const context = await setupPlan(page, 'planning-hitbox', ['Draft neighborhood update'], 1);
  const at = (minute: number) => instantAt(context.date, minute, context.timezone).toISOString();
  await saveDraft(page, {
    ...snapshot(
      context,
      [45],
      [
        {
          id: 'manual-block',
          startsAt: at(600),
          endsAt: at(645),
          pinned: false,
          placementSource: 'manual',
          allocations: [{ taskId: context.taskIds[0] ?? '', plannedMinutes: 45 }],
        },
      ],
    ),
    settings: { startAt: at(540) },
  });
  await openPlan(page, context.date);
  const item = page.locator('[data-schedule-item="manual-block"]').first();
  await item.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Start', { exact: true })).toHaveValue('10:00');
});

test.describe('planning timezone defaults', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('initializes an unset planning timezone from the browser without defaulting to UTC', async ({
    page,
  }) => {
    await signUpAndOnboard(page, 'planning-timezone');
    await page.goto('/plan/day', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Plan today', exact: true })).toBeVisible();
    await expect
      .poll(
        async () => (await apiJson<{ timezone?: string }>(page, '/v1/hub/preferences')).timezone,
      )
      .toBe('America/Los_Angeles');
  });
});

test('requires acknowledgement before accepting a deliberately empty day', async ({ page }) => {
  const context = await setupPlan(page, 'planning-empty-warning', [], 1);
  await openPlan(page, context.date);
  await page.getByRole('button', { name: 'Review plan', exact: true }).last().click();
  await expect(page.getByText('No work is selected for this day.')).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Confirm plan', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Keep this day without planned work' }).check();
  await confirm.click();
  await expect(page.getByText('No work was selected for this day.')).toBeVisible();
  expect(
    (await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`)).accepted?.current.snapshot
      .tasks,
  ).toHaveLength(0);
});

test('Focus shows the current task document and labels the session total', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const context = await setupPlan(page, 'planning-focus-context', ['Draft the meeting brief']);
  await apiJson(page, `/v1/orgs/${context.orgId}/tasks/${context.taskIds[0]}`, {
    method: 'PATCH',
    body: {
      description:
        '## Outcome\n\n' +
        'Prepare the decisions and supporting research for the meeting.\n\n'.repeat(20),
    },
  });
  await apiJson(page, '/v1/time/records', {
    method: 'POST',
    body: { context: { taskId: context.taskIds[0] } },
  });
  await page.goto('/focus', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Outcome' })).toBeVisible();
  await expect(page.getByText('Session total')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause timer' })).toBeInViewport();
  await page.getByRole('button', { name: 'Pause timer' }).click();
  await expect(page.getByRole('button', { name: 'Resume timer' })).toBeVisible();
});

test('all-day context can stop blocking this plan without modifying the calendar', async ({
  page,
}) => {
  const context = await setupPlan(page, 'planning-all-day', [], 1);
  const event = await apiJson<{ id: string }>(page, '/v1/me/calendar/items', {
    method: 'POST',
    body: {
      intent: 'event',
      title: 'Cycle context',
      timezone: context.timezone,
      allDayStartDate: context.date,
      allDayEndDate: addDays(context.date, 1),
    },
  });
  await openPlan(page, context.date);
  const blocks = page.getByRole('checkbox', { name: 'Cycle context blocks work' });
  await expect(blocks).toBeChecked();
  await blocks.uncheck();
  await expect
    .poll(
      async () =>
        (await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`)).draft?.settings
          ?.ignoredAllDayEventIds,
    )
    .toEqual([event.id]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(blocks).not.toBeChecked();
  const source = await apiJson<{ allDayStartDate: string }>(
    page,
    `/v1/me/calendar/items/${event.id}`,
  );
  expect(source.allDayStartDate).toBe(context.date);
});
