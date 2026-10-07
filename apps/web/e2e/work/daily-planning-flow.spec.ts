/** Authenticated proposal, editing, acceptance, and recovery journeys. */
import { addDays, instantAt } from '@docket/planning/zoned-time';
import {
  captureDailyPlanningEvidence,
  dragTo,
  editPlanningTouchWork,
  confirmPlanningTouchPlan,
  openPlan,
  reviewPlan,
  saveDraft,
  setupPlan,
  snapshot,
  type DayRead,
} from '../helpers/daily-planning';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

test('an empty day opens Plan today before the separate available-work browser', async ({
  page,
}, testInfo) => {
  const context = await setupPlan(page, 'daily-empty', []);
  await openPlan(page, context.date);
  let releaseDay: () => void = () => undefined;
  const heldDay = new Promise<void>((resolve) => {
    releaseDay = resolve;
  });
  await page.route('**/v1/daily-plan/day/*', async (route) => {
    if (route.request().method() === 'GET') await heldDay;
    await route.continue();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status', { name: 'Loading daily plan' })).toBeVisible();
  releaseDay();
  await expect(page.getByRole('heading', { name: 'Plan today' })).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add work', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
  await captureDailyPlanningEvidence(page, testInfo, 'add-work');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plan today' })).toBeVisible();
});

test('a late proposal preserves actual work, excludes completed tasks, and resumes after reload', async ({
  page,
}, testInfo) => {
  const context = await setupPlan(page, 'daily-late', [
    'Write launch notes',
    'Completed checklist',
    'Schedule rollout',
  ]);
  await apiJson(page, `/v1/hub/today/items/${context.itemIds[1]}/complete`, { method: 'POST' });
  const openedAt = Date.now();
  await apiJson(page, '/v1/time/records', {
    method: 'POST',
    body: {
      context: { taskId: context.taskIds[0], label: 'Write launch notes' },
      startNow: false,
      captureSource: 'manual',
      startsAt: new Date(openedAt - 45 * 60_000).toISOString(),
      endsAt: new Date(openedAt - 20 * 60_000).toISOString(),
    },
  });
  await openPlan(page, context.date);
  await expect(
    page.getByRole('spinbutton', { name: 'Planned time for Write launch notes' }),
  ).toBeVisible();
  await expect(
    page.getByRole('spinbutton', { name: 'Planned time for Completed checklist' }),
  ).toHaveCount(0);
  await captureDailyPlanningEvidence(page, testInfo, 'plan');
  await reviewPlan(page);
  await captureDailyPlanningEvidence(page, testInfo, 'review');
  const saved = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(saved.draft?.sessions.length).toBeGreaterThan(0);
  expect(
    saved.draft?.tasks.find((task) => task.taskId === context.taskIds[0])?.plannedMinutes,
  ).toBe(25);
  expect(
    saved.draft?.sessions.some((session) =>
      session.allocations.some((part) => part.taskId === context.taskIds[0]),
    ),
  ).toBe(false);
  expect(
    saved.draft?.sessions.some((session) =>
      session.allocations.some((part) => part.taskId === context.taskIds[2]),
    ),
  ).toBe(true);
  expect(
    saved.draft?.sessions.every((session) => Date.parse(session.startsAt) >= openedAt - 60_000),
  ).toBe(true);
  expect(
    saved.actual.some(
      (interval) => interval.taskId === context.taskIds[0] && interval.recordedMinutes >= 25,
    ),
  ).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Review plan', exact: true })).toBeVisible();
  const resumed = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(resumed.draft).toEqual(saved.draft);
});

test('planning around active work preserves the timer and offers Continue after acceptance', async ({
  page,
}, testInfo) => {
  const context = await setupPlan(page, 'daily-active', [
    'Work already tracking',
    'Review the release',
  ]);
  const started = await apiJson<{ id: string }>(page, '/v1/time/records', {
    method: 'POST',
    body: { context: { taskId: context.taskIds[0], label: 'Work already tracking' } },
  });
  await openPlan(page, context.date);
  await reviewPlan(page);
  const day = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(
    day.draft?.sessions.every((session) =>
      session.allocations.every((part) => part.taskId !== context.taskIds[0]),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Confirm plan', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Continue Work already tracking', exact: true }),
  ).toBeVisible();
  await captureDailyPlanningEvidence(page, testInfo, 'confirmation');
  expect((await apiJson<{ record: { id: string } }>(page, '/v1/time/active')).record.id).toBe(
    started.id,
  );
});

test('keyboard editing supports packed and split work and preserves pinned blocks', async ({
  page,
}) => {
  const context = await setupPlan(
    page,
    'daily-keyboard',
    ['Draft the brief', 'Review the notes', 'Send the update'],
    1,
  );
  const at = (minute: number) => instantAt(context.date, minute, context.timezone).toISOString();
  const draft = snapshot(
    context,
    [120, 30, 30],
    [
      {
        id: 'packed',
        startsAt: at(10 * 60),
        endsAt: at(11 * 60),
        pinned: false,
        placementSource: 'manual',
        allocations: [
          { taskId: context.taskIds[0] ?? '', plannedMinutes: 30 },
          { taskId: context.taskIds[1] ?? '', plannedMinutes: 30 },
        ],
      },
      {
        id: 'split',
        startsAt: at(12 * 60),
        endsAt: at(13 * 60),
        pinned: false,
        placementSource: 'manual',
        allocations: [{ taskId: context.taskIds[0] ?? '', plannedMinutes: 60 }],
      },
    ],
  );
  await saveDraft(page, draft);
  await openPlan(page, context.date);
  const schedule = page.locator('[data-schedule-item="packed"]').getByRole('button', {
    name: /^Draft the brief · Review the notes/,
  });
  await schedule.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Edit block' })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Duration for Draft the brief' }).fill('45');
  await page.getByLabel('Keep this block in place').check();
  await page.getByRole('button', { name: 'Save block', exact: true }).click();
  await reviewPlan(page);
  const saved = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  const packed = saved.draft?.sessions.find((session) => session.id === 'packed');
  expect(packed?.pinned).toBe(true);
  expect(packed?.allocations).toHaveLength(2);
  expect(
    saved.draft?.sessions.filter((session) =>
      session.allocations.some((part) => part.taskId === context.taskIds[0]),
    ),
  ).toHaveLength(3);
  await page.getByRole('button', { name: 'Organize day', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Organize day', exact: true })).toBeEnabled();
  if (await page.getByRole('button', { name: 'Apply schedule', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Apply schedule', exact: true }).click();
  await page.getByRole('button', { name: 'Plan tomorrow', exact: true }).click();
  const rebuilt = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(rebuilt.draft?.sessions.find((session) => session.id === 'packed')).toEqual(packed);
});

test('dragging changes the selected sequence and adds work to an existing block', async ({
  page,
}) => {
  const context = await setupPlan(
    page,
    'daily-drag',
    ['Write first note', 'Review second note'],
    1,
  );
  const at = (minute: number) => instantAt(context.date, minute, context.timezone).toISOString();
  await saveDraft(
    page,
    snapshot(
      context,
      [30, 30],
      [
        {
          id: 'first',
          startsAt: at(10 * 60),
          endsAt: at(10 * 60 + 30),
          pinned: false,
          placementSource: 'manual',
          allocations: [{ taskId: context.taskIds[0] ?? '', plannedMinutes: 30 }],
        },
        {
          id: 'second',
          startsAt: at(12 * 60),
          endsAt: at(12 * 60 + 30),
          pinned: false,
          placementSource: 'manual',
          allocations: [{ taskId: context.taskIds[1] ?? '', plannedMinutes: 30 }],
        },
      ],
    ),
  );
  await openPlan(page, context.date);
  const titles = page.getByRole('textbox', { name: /^Task title:/ });
  await dragTo(
    page,
    page.getByRole('button', { name: 'Drag Write first note to reorder or schedule' }),
    page.locator('[data-drop-state]').filter({
      has: page.getByRole('textbox', { name: 'Task title: Review second note' }),
    }),
  );
  await expect(titles.first()).toHaveValue('Review second note');
  await expect(
    page.getByRole('spinbutton', { name: 'Planned time for Write first note' }),
  ).toHaveValue('30');
  await dragTo(
    page,
    page.getByRole('button', { name: 'Drag Write first note to reorder or schedule' }),
    page.locator('[data-schedule-item="second"]'),
  );
  await reviewPlan(page);
  const saved = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(
    saved.draft?.sessions.find((session) => session.id === 'second')?.allocations,
  ).toHaveLength(2);
  expect(
    saved.draft?.tasks.find((task) => task.taskId === context.taskIds[0])?.plannedMinutes,
  ).toBe(30);
});

test.describe('touch planning', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('a phone user edits proposed work and confirms without starting tracking', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const context = await setupPlan(page, 'daily-touch', ['Prepare the brief']);
    await openPlan(page, context.date);
    await editPlanningTouchWork(page, 'Prepare the brief', '30');
    await page.setViewportSize({ width: 320, height: 720 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await confirmPlanningTouchPlan(page);
  });
});

test('missed work previews both recovery choices without changing accepted history', async ({
  page,
}, testInfo) => {
  const context = await setupPlan(page, 'daily-recovery', ['Call the supplier']);
  const startsAt = instantAt(context.date, 8 * 60, context.timezone).toISOString();
  const endsAt = instantAt(context.date, 8 * 60 + 30, context.timezone).toISOString();
  await saveDraft(
    page,
    snapshot(
      context,
      [30],
      [
        {
          id: 'supplier',
          startsAt,
          endsAt,
          pinned: false,
          allocations: [{ taskId: context.taskIds[0] ?? '', plannedMinutes: 30 }],
        },
      ],
    ),
    'review_plan',
  );
  await apiJson(page, `/v1/daily-plan/day/${context.date}/confirm`, { method: 'POST' });
  const accepted = (await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`)).accepted;
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add past time' })).toBeVisible();
  await page.keyboard.press('Escape');
  for (const label of ['Still working', 'Not started']) {
    await page.goto('/today', { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`task=${context.taskIds[0]}`));
    await expect(page.getByText('Changes to the rest of today', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm plan', exact: true })).toBeDisabled();
    if (label === 'Still working')
      await captureDailyPlanningEvidence(page, testInfo, 'revision-preview');
    const previewed = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
    expect(previewed.accepted).toEqual(accepted);
    await page.getByRole('button', { name: 'Keep current', exact: true }).click();
  }
});

test('one yesterday review consolidates missed days and applies bulk choices', async ({
  page,
}, testInfo) => {
  const context = await setupPlan(
    page,
    'daily-yesterday',
    ['Carry the supplier follow-up', 'Return the draft to backlog', 'Finish the old checklist'],
    -3,
  );
  const today = addDays(context.date, 3);
  const yesterday = addDays(today, -1);
  await apiJson(page, '/v1/daily-plan', {
    method: 'POST',
    body: { refOrganizationId: context.orgId, refTaskId: context.taskIds[0], date: yesterday },
  });
  await apiJson(page, '/v1/time/records', {
    method: 'POST',
    body: {
      context: { taskId: context.taskIds[0], label: 'Supplier follow-up' },
      startNow: false,
      captureSource: 'manual',
      startsAt: instantAt(yesterday, 12 * 60, context.timezone).toISOString(),
      endsAt: instantAt(yesterday, 12 * 60 + 15, context.timezone).toISOString(),
    },
  });
  await page.goto(`/plan?view=day&date=${today}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Review yesterday', exact: true })).toBeVisible();
  await expect(page.getByText('15 minutes recorded', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Decision for/ })).toHaveCount(3);
  await captureDailyPlanningEvidence(page, testInfo, 'yesterday');
  await page.getByRole('button', { name: 'Move all to today', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Decision for Carry the supplier follow-up' }),
  ).toHaveValue('today');
  await page
    .getByRole('combobox', { name: 'Decision for Return the draft to backlog' })
    .selectOption('backlog');
  await page
    .getByRole('combobox', { name: 'Decision for Finish the old checklist' })
    .selectOption('done');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plan today', exact: true })).toBeVisible();
  const saved = await apiJson<DayRead & { carryover: unknown[] }>(
    page,
    `/v1/daily-plan/day/${today}`,
  );
  expect(saved.carryover).toHaveLength(0);
  expect(saved.draft?.tasks.map((task) => task.taskId)).toEqual([context.taskIds[0]]);
  const completed = await apiJson<{ completedAt: string | null }>(
    page,
    `/v1/orgs/${context.orgId}/tasks/${context.taskIds[2]}`,
  );
  expect(completed.completedAt).not.toBeNull();
});

test('direct numeric editing resolves work that exceeds the remaining day', async ({ page }) => {
  const context = await setupPlan(page, 'daily-overload', ['Prepare the long report'], 1);
  await saveDraft(page, snapshot(context, [1440], []));
  await openPlan(page, context.date);
  const unplaced = page.getByText(/^\d+ minutes still need a block$/);
  await expect(unplaced).toBeVisible();
  const planned = page.getByRole('spinbutton', {
    name: 'Planned time for Prepare the long report',
  });
  await planned.fill('30');
  const proposed = page.waitForResponse(
    (response) =>
      response.url().includes(`/day/${context.date}/proposal`) &&
      response.request().method() === 'POST',
  );
  await planned.press('Enter');
  await proposed;
  await expect(page.getByRole('button', { name: 'Organize day', exact: true })).toBeEnabled();
  const apply = page.getByRole('button', { name: 'Apply schedule', exact: true });
  if (await apply.isVisible()) await apply.click();
  await expect(unplaced).toHaveCount(0);
  await expect(planned).toHaveValue('30');
  await reviewPlan(page);
  const saved = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(saved.draft?.tasks[0]?.plannedMinutes).toBe(30);
  expect(
    saved.draft?.sessions.reduce(
      (minutes, session) =>
        minutes + session.allocations.reduce((total, part) => total + part.plannedMinutes, 0),
      0,
    ),
  ).toBe(30);
});

test('Retry saves the visible numeric edit after a draft save fails', async ({ page }) => {
  const context = await setupPlan(page, 'daily-retry', ['Keep this estimate'], 1);
  await openPlan(page, context.date);
  let failSave = true;
  await page.route(`**/v1/daily-plan/day/${context.date}/draft`, async (route) => {
    if (route.request().method() === 'PUT' && failSave) await route.abort('failed');
    else await route.continue();
  });
  const planned = page.getByRole('spinbutton', { name: 'Planned time for Keep this estimate' });
  await planned.fill('35');
  await planned.press('Enter');
  await expect(
    page.getByText('Your edits are still here. Save failed.', { exact: true }),
  ).toBeVisible();
  await expect(planned).toHaveValue('35');
  failSave = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByText('Your edits are still here. Save failed.', { exact: true }),
  ).toHaveCount(0);
  const saved = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(saved.draft?.tasks[0]?.plannedMinutes).toBe(35);
  await expect(planned).toHaveValue('35');
  await page.unrouteAll({ behavior: 'wait' });
});

test('renaming split work updates both sessions while keeping the title focused', async ({
  page,
}) => {
  const context = await setupPlan(page, 'daily-rename', ['Draft the split report'], 1);
  const at = (minute: number) => instantAt(context.date, minute, context.timezone).toISOString();
  await saveDraft(
    page,
    snapshot(
      context,
      [90],
      [
        {
          id: 'rename-one',
          startsAt: at(10 * 60),
          endsAt: at(10 * 60 + 30),
          pinned: false,
          placementSource: 'manual',
          allocations: [{ taskId: context.taskIds[0] ?? '', plannedMinutes: 30 }],
        },
        {
          id: 'rename-two',
          startsAt: at(12 * 60),
          endsAt: at(13 * 60),
          pinned: false,
          placementSource: 'manual',
          allocations: [{ taskId: context.taskIds[0] ?? '', plannedMinutes: 60 }],
        },
      ],
    ),
  );
  await openPlan(page, context.date);
  const title = page.getByRole('textbox', { name: 'Task title: Draft the split report' });
  const renamed = page.waitForResponse(
    (response) =>
      response.url().includes(`/tasks/${context.taskIds[0]}`) &&
      response.request().method() === 'PATCH',
  );
  await title.fill('Write the final report');
  await renamed;
  const updatedTitle = page.getByRole('textbox', { name: 'Task title: Write the final report' });
  await expect(updatedTitle).toBeFocused();
  await expect(updatedTitle).toHaveValue('Write the final report');
  for (const id of ['rename-one', 'rename-two']) {
    await expect(
      page
        .locator(`[data-schedule-item="${id}"]`)
        .getByRole('button', { name: /^Write the final report/ }),
    ).toBeVisible();
  }
  await expect(updatedTitle).toBeFocused();
  const saved = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(saved.draft?.sessions.map((session) => session.id)).toEqual(['rename-one', 'rename-two']);
});
