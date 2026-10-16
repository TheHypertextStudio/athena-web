/** Proportional short blocks remain distinct in planning and the accepted Today agenda. */
import type { Page } from '@playwright/test';
import type { DayRead, PlanningContext } from '../helpers/daily-planning';
import { instantAt, localMinuteOfDay } from '@docket/planning/zoned-time';
import {
  openPlan,
  reviewPlan,
  saveDraft,
  setupPlan,
  snapshot,
  showPlanningPanel,
} from '../helpers/daily-planning';
import { expect, test } from '../helpers/fixtures';
import { captureShortBlockEvidence } from '../helpers/daily-planning';

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => {
  // Exercise planning persistence without sending an optional provider assessment.
  await page.route('**/v1/daily-plan/day/*/assessment', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
});
test('five-minute adjacent blocks keep exact geometry before and after acceptance', async ({
  page,
}, testInfo) => {
  const context = await setupPlan(page, 'daily-short-geometry', [
    'Five-minute check',
    'Adjacent five-minute check',
  ]);
  const start = Math.ceil(localMinuteOfDay(new Date(), context.timezone)) + 10;
  const sessions = context.taskIds.map((taskId, index) => ({
    id: `short-${index}`,
    pinned: true,
    startsAt: instantAt(context.date, start + index * 5, context.timezone).toISOString(),
    endsAt: instantAt(context.date, start + (index + 1) * 5, context.timezone).toISOString(),
    allocations: [{ taskId, plannedMinutes: 5 }],
  }));
  await saveDraft(page, snapshot(context, [5, 5], sessions));
  await openPlan(page, context.date);
  const first = page.locator('[data-schedule-item="short-0"]');
  const second = page.locator('[data-schedule-item="short-1"]');
  await expect(first).toHaveCSS('height', '7px');
  await expect(second).toHaveCSS('height', '7px');
  await expect(first).toHaveAttribute('data-layout-column-count', '1');
  await expect(second).toHaveAttribute('data-layout-column-count', '1');
  const firstTop = await first.evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.top),
  );
  const secondTop = await second.evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.top),
  );
  expect(secondTop - firstTop).toBe(7);
  await captureShortBlockEvidence(page, testInfo, 'plan', 'short-0', '7px');
  await reviewPlan(page);
  await captureShortBlockEvidence(page, testInfo, 'review', 'short-0', '7px');
  await page.getByRole('button', { name: 'Confirm plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your plan is set' })).toBeVisible();
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await captureShortBlockEvidence(page, testInfo, 'today', `${context.taskIds[0]}:short-0`, '4px');
});

/** Seed optional capture states after the persistence assertions have passed. */
async function seedPlanningCaptureFixtures(
  page: Page,
  context: PlanningContext,
  late: string,
): Promise<void> {
  const { apiJson } = await import('../helpers/net');
  const { addDays } = await import('@docket/planning/zoned-time');
  const { orgId, date, taskIds } = context;
  const readDay = () => apiJson<DayRead>(page, `/v1/daily-plan/day/${date}`);
  const evidence = process.env['E2E_PLANNING_EVIDENCE'];
  if (evidence) {
    const { writeFileSync } = await import('node:fs');
    const captureDate = addDays(date, 1);
    const afterFinishDate = new Date().toISOString().slice(0, 10);
    for (const fixtureDate of [captureDate, afterFinishDate]) {
      for (const taskId of taskIds)
        await apiJson(page, '/v1/daily-plan', {
          method: 'POST',
          body: { date: fixtureDate, refOrganizationId: orgId, refTaskId: taskId },
        });
    }
    await saveDraft(page, {
      ...snapshot({ ...context, date: captureDate }, [60, 60], []),
      finishAt: `${captureDate}T12:00:00.000Z`,
      settings: { startAt: `${captureDate}T11:55:00.000Z`, bufferPercent: 0 },
    });
    await saveDraft(page, {
      ...snapshot(
        { ...context, date: afterFinishDate },
        [60, 60],
        [
          {
            id: 'historical-capture',
            startsAt: `${afterFinishDate}T00:00:00.000Z`,
            endsAt: `${afterFinishDate}T00:05:00.000Z`,
            allocations: [{ taskId: late, plannedMinutes: 5 }],
            pinned: true,
          },
        ],
      ),
      finishAt: `${afterFinishDate}T00:10:00.000Z`,
      settings: { startAt: `${afterFinishDate}T00:00:00.000Z`, bufferPercent: 0 },
    });
    writeFileSync(
      `${evidence}/daily-fixture.json`,
      JSON.stringify(
        { orgId, date, captureDate, afterFinishDate, taskIds, snapshot: (await readDay()).draft },
        null,
        2,
      ),
    );
  }
}

test.describe('planning recovery runtime', () => {
  const session = process.env['E2E_PLANNING_SESSION'];
  if (session) test.use({ storageState: session });

  test('persists the five-minute final block and guards new blocks after finish while keeping existing edits', async ({
    page,
  }) => {
    const { apiJson } = await import('../helpers/net');
    const { addDays } = await import('@docket/planning/zoned-time');
    const { signUpAndOnboard } = await import('../helpers/app');
    await page.goto('/today', { waitUntil: 'domcontentloaded' });
    const orgId = session
      ? (await apiJson<{ items: { id: string }[] }>(page, '/v1/orgs')).items[0]?.id
      : (await signUpAndOnboard(page, 'LateBlockRecovery')).orgId;
    if (!orgId) throw new Error('The authenticated workspace is missing.');
    await apiJson(page, '/v1/hub/preferences', { method: 'PATCH', body: { timezone: 'UTC' } });
    const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
    const date = addDays(new Date().toISOString().slice(0, 10), 1);
    const taskIds: string[] = [];
    for (const title of ['Late five-minute task', 'After-finish new task']) {
      const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
        method: 'POST',
        body: { title, teamId: teams.items[0]?.id },
      });
      taskIds.push(task.id);
      await apiJson(page, '/v1/daily-plan', {
        method: 'POST',
        body: { date, refOrganizationId: orgId, refTaskId: task.id },
      });
    }
    const late = taskIds[0];
    if (!late) throw new Error('The selected task is missing.');
    const context = { orgId, date, timezone: 'UTC', taskIds, itemIds: [] };
    await saveDraft(page, {
      ...snapshot(context, [60, 60], []),
      finishAt: `${date}T12:00:00.000Z`,
      settings: { startAt: `${date}T11:55:00.000Z`, bufferPercent: 0 },
    });
    await page.goto(`/plan/day?date=${date}`, { waitUntil: 'domcontentloaded' });
    await showPlanningPanel(page, 'Agenda');
    await expect(page.getByRole('button', { name: 'Organize day', exact: true })).toBeEnabled();
    const keep = page.getByRole('button', { name: 'Keep current', exact: true });
    if (await keep.isVisible()) await keep.click();
    await showPlanningPanel(page, 'Work');
    await page
      .getByRole('button', { name: 'Actions for Late five-minute task', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Schedule', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('spinbutton', { name: 'Duration for Late five-minute task', exact: true }),
    ).toHaveValue('5');
    await dialog.getByRole('button', { name: 'Save block', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const readDay = () => apiJson<DayRead>(page, `/v1/daily-plan/day/${date}`);
    await expect
      .poll(async () => (await readDay()).draft?.sessions[0]?.endsAt)
      .toBe(`${date}T12:00:00.000Z`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await showPlanningPanel(page, 'Agenda');
    await expect(page.getByRole('button', { name: 'Organize day', exact: true })).toBeEnabled();
    expect((await readDay()).draft?.sessions[0]?.allocations).toEqual([
      { taskId: late, plannedMinutes: 5 },
    ]);
    await page.clock.setFixedTime(`${date}T12:01:00.000Z`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await showPlanningPanel(page, 'Agenda');
    await expect(page.getByRole('button', { name: 'Organize day', exact: true })).toBeEnabled();
    if (await keep.isVisible()) await keep.click();
    await showPlanningPanel(page, 'Work');
    await page
      .getByRole('button', { name: 'Actions for After-finish new task', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Schedule', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Save block', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('status')).toContainText(
      'No time remains before your finish time',
    );
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await showPlanningPanel(page, 'Work');
    await page
      .getByRole('button', { name: 'Actions for Late five-minute task', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Move block', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Edit block', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save block', exact: true })).toBeEnabled();
    await dialog.getByRole('checkbox', { name: 'Keep this block in place' }).check();
    await dialog.getByRole('button', { name: 'Save block', exact: true }).click();
    await expect.poll(async () => (await readDay()).draft?.sessions[0]?.pinned).toBe(true);
    await seedPlanningCaptureFixtures(page, context, late);
  });
});
