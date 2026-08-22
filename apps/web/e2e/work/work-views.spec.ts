import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

interface SeededRoster {
  readonly task: string;
  readonly project: string;
  readonly program: string;
  readonly initiative: string;
}

/** Seed one row for every organization-level planning roster. */
async function seedRosters(page: Page, orgId: string): Promise<SeededRoster> {
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('Onboarding produced no Team');
  const initiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: { name: 'Transit access' },
  });
  const program = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/programs`, {
    method: 'POST',
    body: { name: 'Service planning' },
  });
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name: 'Frequent network', teamId, initiativeIds: [initiative.id] },
  });
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Map ten-minute service', teamId, projectId: project.id },
  });
  return {
    task: task.id,
    project: project.id,
    program: program.id,
    initiative: initiative.id,
  };
}

test('all four rosters execute typed views and preserve layout and saved-view state', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const { orgId } = await signUpAndOnboard(page, 'TypedWorkViews');
  await seedRosters(page, orgId);

  for (const [route, title, row] of [
    ['tasks', 'Tasks', 'Map ten-minute service'],
    ['projects', 'Projects', 'Frequent network'],
    ['programs', 'Programs', 'Service planning'],
    ['initiatives', 'Initiatives', 'Transit access'],
  ] as const) {
    await page.goto(orgHref(orgId, route), {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.pageReady,
    });
    await expect(page.getByRole('heading', { name: title })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await expect(page.getByText(row, { exact: true })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await expect(
      page.getByRole('toolbar', { name: `${title.slice(0, -1)} view controls` }),
    ).toBeVisible();
  }

  await page.goto(orgHref(orgId, 'tasks'), { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByRole('textbox', { name: 'View name' }).fill('Dispatch queue');
  await page
    .getByRole('dialog', { name: 'Save view' })
    .getByRole('button', { name: 'Save view' })
    .click();
  await expect(page.getByRole('tab', { name: 'Dispatch queue' })).toBeVisible();

  await page.getByRole('button', { name: 'More view controls' }).click();
  await page.getByRole('menuitem', { name: 'Layout' }).click();
  await page
    .getByRole('dialog', { name: 'Layout view' })
    .getByRole('radio', { name: 'Board' })
    .click();
  await expect(page.getByRole('region', { name: 'Task board' })).toBeVisible();
});
