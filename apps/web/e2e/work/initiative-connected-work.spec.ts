/**
 * End-to-end proof that an Initiative can be scoped into Projects without leaving its own page:
 * type names into the quick-add, link an existing Project, and see each one filed under the
 * Program that holds it.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

const sessionPath = process.env['E2E_INITIATIVE_SESSION'];
if (sessionPath) test.use({ storageState: sessionPath });

/** Create one row through the signed-in browser session and return its id. */
async function create(page: Page, path: string, body: unknown): Promise<string> {
  return (await apiJson<{ id: string }>(page, path, { method: 'POST', body })).id;
}

test('an Initiative creates, links, and groups its Projects in place', async ({ page }) => {
  const { orgId } = sessionPath
    ? (JSON.parse(readFileSync(`${sessionPath}.meta.json`, 'utf8')) as { orgId: string })
    : await signUpAndOnboard(page, 'InitiativeConnectedWork');
  if (sessionPath) await page.goto('/', { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
  const initiativeId = await create(page, `/v1/orgs/${orgId}/initiatives`, {
    name: 'Fare-free pilot',
    summary: 'Prove the fare cut pays for itself.',
  });
  const programId = await create(page, `/v1/orgs/${orgId}/programs`, {
    name: 'Service quality',
    summary: 'Everything that makes a ride worth taking again.',
  });
  const strayId = await create(page, `/v1/orgs/${orgId}/projects`, {
    name: 'Shelter shade audit',
    summary: 'Where riders stand in the heat.',
  });
  await create(page, `/v1/orgs/${orgId}/projects`, {
    name: 'Fare capping study',
    summary: 'What a daily cap costs before the fare goes to zero.',
    initiativeIds: [initiativeId],
  });
  await apiJson(page, `/v1/orgs/${orgId}/initiatives/${initiativeId}/programs`, {
    method: 'POST',
    body: { programId },
  });

  await page.goto(orgHref(orgId, `initiatives/${initiativeId}?tab=work`), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  const panel = page.getByRole('tabpanel', { name: 'Connected work' });
  await expect(panel.getByRole('link', { name: 'Service quality' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  const device = await page.context().newCDPSession(page);
  await device.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await page.setViewportSize({ width: 390, height: 600 });
  const disclosure = panel.getByRole('button', { name: 'Collapse Service quality' });
  const target = await disclosure.boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(40);
  expect(target?.height).toBeGreaterThanOrEqual(40);
  await disclosure.click();
  await panel.getByRole('button', { name: 'Expand Service quality' }).click();
  await device.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  await page.setViewportSize({ width: 1440, height: 900 });
  // A Project row states what it is for; the Program heading states a title and a count.
  await expect(
    panel.getByText('What a daily cap costs before the fare goes to zero.'),
  ).toBeVisible();
  await expect(panel.getByText('Everything that makes a ride worth taking again.')).toHaveCount(0);

  // Two in a row without a modal and without leaving: the field stays put and keeps focus.
  const loose = panel.getByPlaceholder('Add a project…');
  await loose.fill('Model the revenue shortfall');
  await loose.press('Enter');
  await expect(panel.getByRole('link', { name: 'Model the revenue shortfall' })).toBeVisible();
  // A Project row carries the summary someone wrote, never the word "Project" repeated down the
  // column. The Program heading above it carries a title and a count and nothing else.
  await expect(panel.getByText('Where riders stand in the heat.')).toHaveCount(0);
  await expect(panel.getByText('Everything that makes a ride worth taking again.')).toHaveCount(0);
  await expect(loose).toHaveValue('');
  await expect(loose).toBeFocused();
  await loose.fill('Retrain operators');
  await loose.press('Enter');
  await expect(panel.getByRole('link', { name: 'Retrain operators' })).toBeVisible();
  await expect(page).toHaveURL(/tab=work/);

  // A name typed inside the Program group files the Project under that Program.
  const inProgram = panel.getByPlaceholder('Add to Service quality…');
  await inProgram.fill('Replace the farebox fleet');
  await inProgram.press('Enter');
  const farebox = panel.locator('[data-object-kind="project"]', {
    hasText: 'Replace the farebox fleet',
  });
  await expect(farebox).toBeVisible();
  const filed = await apiJson<{ items: { name: string; programId: string | null }[] }>(
    page,
    `/v1/orgs/${orgId}/projects`,
  );
  expect(
    filed.items.find((project) => project.name === 'Replace the farebox fleet')?.programId,
  ).toBe(programId);
  expect(filed.items.find((project) => project.name === 'Retrain operators')?.programId).toBeNull();

  // The same field attaches what already exists: type part of its name and it is offered.
  await loose.fill('Shelter');
  await page.getByRole('option', { name: /Shelter shade audit/ }).click();
  const strayRow = panel.locator(`[data-object-kind="project"][data-object-id="${strayId}"]`);
  await expect(strayRow).toBeVisible();
  await expect(loose).toHaveValue('');

  // And leaves through the object's own menu — the same one a right-click opens — rather than a
  // bare X that said nothing about whether it deleted the project.
  await strayRow.hover();
  await panel.getByRole('button', { name: 'Shelter shade audit actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Remove from this initiative' }).click();
  await expect(strayRow).toHaveCount(0);
});
