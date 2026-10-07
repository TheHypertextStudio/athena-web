/** Accepted history and evening review preserve existing planning choices. */
import { addDays, instantAt } from '@docket/planning/zoned-time';
import {
  captureDailyPlanningEvidence,
  planningTimezone,
  openPlan,
  reviewPlan,
  saveDraft,
  setupPlan,
  snapshot,
  type DayRead,
} from '../helpers/daily-planning';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

test('Review day applies bulk choices while preserving the saved tomorrow draft and today timer', async ({
  page,
}) => {
  const context = await setupPlan(
    page,
    'daily-evening-review',
    ['Tomorrow first task', 'Today active task', 'Finish today checklist'],
    0,
    planningTimezone(15 * 60, 20 * 60),
  );
  const tomorrow = addDays(context.date, 1);
  const tomorrowContext = { ...context, date: tomorrow, taskIds: context.taskIds.slice(0, 2) };
  const draft = snapshot(
    tomorrowContext,
    [90, 60],
    [
      {
        id: 'tomorrow-pinned',
        startsAt: instantAt(tomorrow, 9 * 60, context.timezone).toISOString(),
        endsAt: instantAt(tomorrow, 11 * 60 + 30, context.timezone).toISOString(),
        pinned: true,
        allocations: [
          { taskId: context.taskIds[0] ?? '', plannedMinutes: 90 },
          { taskId: context.taskIds[1] ?? '', plannedMinutes: 60 },
        ],
      },
    ],
  );
  await saveDraft(page, draft);
  await apiJson(page, '/v1/time/records', {
    method: 'POST',
    body: {
      context: { taskId: context.taskIds[0], label: 'Earlier work' },
      startNow: false,
      captureSource: 'manual',
      startsAt: instantAt(context.date, 13 * 60, context.timezone).toISOString(),
      endsAt: instantAt(context.date, 13 * 60 + 15, context.timezone).toISOString(),
    },
  });
  await apiJson(page, '/v1/time/records', {
    method: 'POST',
    body: { context: { taskId: context.taskIds[1], label: 'Today active task' } },
  });
  const active = await apiJson<{ record: { id: string; taskId: string } }>(page, '/v1/time/active');
  await openPlan(page, context.date);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.getByRole('link', { name: 'Review day', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`date=${tomorrow}.*review=day`));
  await expect(page.getByRole('heading', { name: 'Review today', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Decision for/ })).toHaveCount(3);
  await page.getByRole('button', { name: 'Move all to tomorrow', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Decision for Finish today checklist' })
    .selectOption('done');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plan tomorrow', exact: true })).toBeVisible();
  const saved = await apiJson<DayRead>(page, `/v1/daily-plan/day/${tomorrow}`);
  expect(saved.draft?.tasks.map((task) => [task.taskId, task.plannedMinutes])).toEqual(
    draft.tasks.map((task) => [task.taskId, task.plannedMinutes]),
  );
  expect(saved.draft?.sessions).toEqual(draft.sessions);
  expect(saved.actual).toEqual([]);
  await reviewPlan(page);
  await page.getByRole('button', { name: 'Confirm plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your plan is set' })).toBeVisible();
  await expect(page.getByText('Tomorrow first task', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Start|Continue) / })).toHaveCount(0);
  const continued = await apiJson<{ record: { id: string; taskId: string } }>(
    page,
    '/v1/time/active',
  );
  expect(continued.record.id).toBe(active.record.id);
  expect(continued.record.taskId).toBe(context.taskIds[1]);
});

test('an accepted adjustment preserves original history and Undo restores the previous plan', async ({
  page,
}, testInfo) => {
  const context = await setupPlan(page, 'daily-history', [
    'Write the release update',
    'Review the checklist',
  ]);
  await openPlan(page, context.date);
  await reviewPlan(page);
  await page.getByRole('button', { name: 'Confirm plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your plan is set' })).toBeVisible();
  expect((await apiJson<{ record: unknown }>(page, '/v1/time/active')).record).toBeNull();
  const original = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  await page.getByRole('button', { name: 'Go to Today' }).click();
  await captureDailyPlanningEvidence(page, testInfo, 'today');
  await page.getByRole('link', { name: 'Adjust today' }).click();
  await page.getByRole('button', { name: 'Actions for Review the checklist' }).click();
  await page.getByRole('menuitem', { name: 'Remove from today' }).click();
  await reviewPlan(page);
  const apply = page.getByRole('button', { name: 'Apply schedule', exact: true });
  if (await apply.isVisible()) await apply.click();
  await page.getByRole('button', { name: 'Confirm plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plan updated' })).toBeVisible();
  await captureDailyPlanningEvidence(page, testInfo, 'revision');
  const adjusted = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(adjusted.accepted?.original).toEqual(original.accepted?.original);
  expect(adjusted.accepted?.history).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo update' }).click();
  await expect(page.getByRole('button', { name: 'Undo update' })).toHaveCount(0);
  const restored = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(restored.accepted?.current.snapshot).toEqual(original.accepted?.current.snapshot);
  expect(restored.accepted?.history).toHaveLength(3);
});
