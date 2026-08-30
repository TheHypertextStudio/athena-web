/** Browser proof that Project Initiative links survive real picker writes and reloads. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson, waitForApiResponse } from '../helpers/net';

const SHOT_ROOT = resolve(
  import.meta.dirname,
  '../../../../apps/web/.data/design-review/entity-detail-header',
);

test.use({ serviceWorkers: 'block' });

/** Create a disposable Project with one visible Initiative link. */
async function createFixture(
  page: Page,
  orgId: string,
): Promise<{
  readonly projectId: string;
  readonly firstInitiative: string;
  readonly secondInitiative: string;
}> {
  const teams = await apiJson<{ items: readonly { id: string }[] }>(
    page,
    `/v1/orgs/${orgId}/teams`,
  );
  const teamId = teams.items[0]?.id;
  expect(teamId, 'onboarding should create one default team').toBeTruthy();
  const [first, second] = await Promise.all([
    apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
      method: 'POST',
      body: { name: 'Safe streets' },
    }),
    apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
      method: 'POST',
      body: { name: 'Frequent buses' },
    }),
  ]);
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name: 'Street redesign', teamId, initiativeIds: [first.id] },
  });
  return { projectId: project.id, firstInitiative: first.id, secondInitiative: second.id };
}

/** Open the Project relationship picker and wait for its browser-visible options. */
async function openInitiatives(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Initiatives —/ }).click();
  await expect(page.getByRole('listbox', { name: 'Initiatives' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
}

test('Project Initiative links render on first paint and survive picker replacement after reload', async ({
  page,
}) => {
  test.setTimeout(240_000);
  mkdirSync(SHOT_ROOT, { recursive: true });
  const { orgId } = await signUpAndOnboard(page, 'ProjectInitiativeAssociations');
  const fixture = await createFixture(page, orgId);
  const projectPath = orgHref(orgId, `projects/${fixture.projectId}`);
  const patchUrl = new RegExp(`/v1/orgs/${orgId}/projects/${fixture.projectId}(?:\\?|$)`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(projectPath, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  await expect(page.getByRole('heading', { name: 'Street redesign' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('button', { name: 'Initiatives — Safe streets' })).toBeVisible();
  await page.screenshot({
    path: resolve(SHOT_ROOT, 'project-initiative-association-wide-initial.png'),
  });

  await openInitiatives(page);
  const addResponse = waitForApiResponse(page, patchUrl, { method: 'PATCH' });
  await page.getByRole('option', { name: 'Frequent buses' }).click();
  expect((await addResponse).status()).toBe(200);

  await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  await expect(page.getByRole('button', { name: 'Initiatives — 2 initiatives' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  await openInitiatives(page);
  const removeResponse = waitForApiResponse(page, patchUrl, { method: 'PATCH' });
  await page.getByRole('option', { name: 'Safe streets' }).click();
  expect((await removeResponse).status()).toBe(200);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  await expect(page.getByRole('button', { name: 'Initiatives — Frequent buses' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: resolve(SHOT_ROOT, 'project-initiative-association-390-final.png'),
  });
});
