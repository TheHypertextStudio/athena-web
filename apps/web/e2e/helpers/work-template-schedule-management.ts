/** Persisted Program schedule lifecycle and response-loss recovery acceptance. */
import type { Page } from '@playwright/test';
import type { WorkScheduleOut, WorkScheduleRunOut } from '@docket/work/work-schedule-management';
import { expect } from './fixtures';
import { apiJson, waitForApiResponse } from './net';
import { blueprintWorkspace, seedBlueprintTemplate } from './work-template-blueprints';
import { TIMEOUTS } from './constants';

/** Verify real schedule lifecycle and a retry after the first run response was lost. */
export async function verifyCanonicalProgramSchedule(page: Page): Promise<void> {
  const workspace = await blueprintWorkspace(page);
  const path = `/v1/orgs/${workspace.orgId}`;
  const event = await seedBlueprintTemplate(page, workspace.orgId, 'project');
  const program = await apiJson<{ id: string }>(page, `${path}/programs`, {
    method: 'POST',
    body: { name: 'Neighborhood routine management', teamId: workspace.teamId },
  });
  const { today, timezone } = await page.evaluate(() => ({
    today: new Date().toLocaleDateString('en-CA'),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  const schedule = await apiJson<WorkScheduleOut>(page, `${path}/work-schedules`, {
    method: 'POST',
    body: {
      ownerProgramId: program.id,
      name: 'Neighborhood dinner on request',
      effectiveFrom: today,
      trigger: { kind: 'manual' },
      document: {
        kind: 'schedule',
        revision: 1,
        template: {
          targetType: 'project',
          workTypeId: event.publication.id,
          selection: { kind: 'latest' },
        },
        titlePattern: 'Neighborhood dinner {year}',
        timezone,
        root: {
          kind: 'project',
          fields: {},
          dates: {},
          placement: { programId: program.id },
          teamId: workspace.teamId,
        },
        stepOverrides: [],
        optionalChoices: [],
      },
    },
  });
  await page.goto(`/orgs/${workspace.orgId}/programs/${program.id}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('tab', { name: 'Schedules', exact: true }).click();
  const card = page.getByRole('article', { name: schedule.name, exact: true });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await verifyLostRunResponse(page, path, schedule);
  await card.getByRole('button', { name: `Run history for ${schedule.name}`, exact: true }).click();
  const history = page.getByRole('dialog', { name: schedule.name, exact: true });
  await expect(history.getByText('Created', { exact: true })).toBeVisible();
  await expect(
    history.getByRole('link', { name: 'Open created project', exact: true }),
  ).toHaveCount(1);
  await page.keyboard.press('Escape');
  await card
    .getByRole('button', { name: `More actions for ${schedule.name}`, exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'End schedule', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'End this schedule?', exact: true })
    .getByRole('button', { name: 'End schedule', exact: true })
    .click();
  await expect(card.getByText('Ended', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: `Run history for ${schedule.name}`, exact: true }).click();
  await expect(
    history.getByRole('link', { name: 'Open created project', exact: true }),
  ).toHaveCount(1);
  const saved = await apiJson<WorkScheduleOut>(page, `${path}/work-schedules/${schedule.id}`);
  expect(saved.status).toBe('ended');
}

async function verifyLostRunResponse(
  page: Page,
  path: string,
  schedule: WorkScheduleOut,
): Promise<void> {
  const card = page.getByRole('article', { name: schedule.name, exact: true });
  await card
    .getByRole('button', { name: `More actions for ${schedule.name}`, exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Run for a date', exact: true }).click();
  const run = page.getByRole('dialog', { name: `Run ${schedule.name}`, exact: true });
  let committed: WorkScheduleRunOut | undefined;
  await page.route(
    `**/work-schedules/${schedule.id}/runs`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = (await response.json()) as WorkScheduleRunOut;
      await route.abort('failed');
    },
    { times: 1 },
  );
  await run.getByRole('button', { name: 'Create this run', exact: true }).click();
  await expect(run.getByText('Run was not created', { exact: true })).toBeVisible();
  const recovered = waitForApiResponse(page, new RegExp(`/work-schedules/${schedule.id}/runs$`), {
    method: 'POST',
  });
  await run.getByRole('button', { name: 'Create this run', exact: true }).click();
  const response = await recovered;
  expect(response.ok()).toBe(true);
  const repeated = (await response.json()) as WorkScheduleRunOut;
  expect(committed?.id).toBeTruthy();
  expect(repeated.id).toBe(committed?.id);
  expect(repeated.roots).toEqual(committed?.roots);
  await expect(run).not.toBeVisible();
  const history = await apiJson<{ items: WorkScheduleRunOut[] }>(
    page,
    `${path}/work-schedules/${schedule.id}/runs`,
  );
  expect(history.items).toHaveLength(1);
  expect(history.items[0]?.id).toBe(committed?.id);
}
