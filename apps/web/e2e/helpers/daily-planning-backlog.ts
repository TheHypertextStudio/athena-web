/** Realistic assigned-backlog planning and execution acceptance. */
import type { Page, TestInfo } from '@playwright/test';
import {
  captureDailyPlanningEvidence,
  openPlan,
  reviewPlan,
  saveDraft,
  setupPlan,
  snapshot,
  type DayRead,
} from './daily-planning';
import { expect } from './fixtures';
import { apiJson } from './net';

/** Verify a bounded proposed day can be accepted and its next task started. */
export async function runAssignedBacklogPlanning(page: Page, testInfo: TestInfo): Promise<void> {
  const context = await setupPlan(page, 'daily-assigned-backlog', []);
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${context.orgId}/teams`);
  const members = await apiJson<{ items: { actorId: string }[] }>(
    page,
    `/v1/orgs/${context.orgId}/members`,
  );
  for (let index = 0; index < 14; index += 1) {
    await apiJson(page, `/v1/orgs/${context.orgId}/tasks`, {
      method: 'POST',
      body: {
        title: `Backlog work ${index + 1}`,
        teamId: teams.items[0]?.id,
        assigneeId: members.items[0]?.actorId,
      },
    });
  }
  const now = Math.ceil(Date.now() / 60_000) * 60_000;
  await saveDraft(page, {
    ...snapshot(context, [], []),
    finishAt: new Date(now + 100 * 60_000).toISOString(),
    settings: { startAt: new Date(now).toISOString(), bufferPercent: 15 },
  });
  await openPlan(page, context.date);
  await expect(
    page.getByRole('spinbutton', { name: /^Planned time for Backlog work/ }),
  ).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Unscheduled', exact: true })).toHaveCount(0);
  await captureDailyPlanningEvidence(page, testInfo, 'bounded-backlog');
  await reviewPlan(page);
  await page.getByRole('button', { name: 'Confirm plan', exact: true }).click();
  const start = page.getByRole('button', { name: /^Start Backlog work/ });
  await expect(start).toBeVisible();
  expect((await apiJson<{ record: unknown }>(page, '/v1/time/active')).record).toBeNull();
  await page.getByRole('button', { name: 'Go to Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const adjustment = page.getByRole('link', { name: 'Adjust plan', exact: true }).last();
  const actions = page.getByRole('button', { name: 'More actions', exact: true }).first();
  await expect(adjustment.or(actions).first()).toBeVisible();
  if ((await adjustment.count()) > 0) {
    await adjustment.press('Enter');
  } else {
    await actions.press('Enter');
    await page.getByRole('menuitem', { name: 'Adjust plan', exact: true }).press('Enter');
  }
  await expect(page).toHaveURL(new RegExp(`/plan/day\\?date=${context.date}&task=`));
  await expect(page.getByRole('complementary', { name: 'Navigation' })).toHaveCount(0);
  const editor = page.getByRole('dialog', { name: 'Edit block', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
  await expect(editor).toBeHidden();
  await reviewPlan(page);
  await page.getByRole('button', { name: 'Confirm plan', exact: true }).click();
  await expect(start).toBeVisible();
  await start.click();
  await expect(page).toHaveURL(/\/focus$/);
  const active = await apiJson<{ record: { taskId: string; status: string } }>(
    page,
    '/v1/time/active',
  );
  const accepted = await apiJson<DayRead>(page, `/v1/daily-plan/day/${context.date}`);
  expect(active.record.taskId).toBe(accepted.accepted?.current.snapshot.tasks[0]?.taskId);
  expect(active.record.status).toBe('open');
}
