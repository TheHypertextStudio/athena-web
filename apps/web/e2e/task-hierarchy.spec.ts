/** End-to-end proof for menu- and Action Registry-driven task hierarchy changes. */
import type { Locator, Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { signUpAndOnboard } from './helpers/app';
import { orgHref, TIMEOUTS } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { apiJson } from './helpers/net';

interface TaskRecord {
  id: string;
  parentTaskId: string | null;
}

const evidencePath = (name: string): string =>
  fileURLToPath(new URL(`../../../docs/design/audits/evidence/${name}`, import.meta.url));

async function captureHierarchyEvidence(page: Page, orgId: string): Promise<void> {
  if (process.env['CAPTURE_TASK_HIERARCHY_EVIDENCE'] !== '1') return;
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(orgHref(orgId, 'initiatives'), {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.pageReady,
    });
    await expect(page.getByText('Frequent network', { exact: true })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await expect(page.getByTestId('initiative-hierarchy-rail').first()).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.mouse.move(viewport.width - 4, 4);
      await page.screenshot({
        path: evidencePath(`2026-08-23-object-relations-${viewport.name}-${colorScheme}.png`),
        animations: 'disabled',
      });
    }
  }
}

async function captureActiveDropEvidence(
  page: Page,
  orgId: string,
  sourceId: string,
  targetId: string,
): Promise<void> {
  if (process.env['CAPTURE_TASK_HIERARCHY_EVIDENCE'] !== '1') return;
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto(orgHref(orgId, 'graph'), {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.pageReady,
    });
    const source = page.locator(`.react-flow__node[data-id="${sourceId}"] .task-branch-header`);
    const target = page.locator(`.react-flow__node[data-id="${targetId}"] .task-branch-header`);
    await expect(source).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await expect(target).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
      await expect(source).toBeVisible({ timeout: TIMEOUTS.pageReady });
      await expect(target).toBeVisible();
      await page.locator('.react-flow__controls-fitview').click();
      await page.waitForTimeout(250);
      const from = await source.boundingBox();
      const to = await target.boundingBox();
      if (!from || !to) throw new Error('Task graph relation targets must have measurable bounds');
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.keyboard.down('Alt');
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
      await page.screenshot({
        path: evidencePath(`2026-08-23-object-relation-drag-${viewport.name}-${colorScheme}.png`),
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await page.keyboard.up('Alt');
    }
  }
}

async function createTask(
  page: Page,
  orgId: string,
  teamId: string,
  title: string,
): Promise<string> {
  return (
    await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title, teamId },
    })
  ).id;
}

async function expectParent(
  page: Page,
  orgId: string,
  taskId: string,
  parentTaskId: string | null,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await apiJson<TaskRecord>(page, `/v1/orgs/${orgId}/tasks/${taskId}`)).parentTaskId,
      { timeout: TIMEOUTS.pageReady },
    )
    .toBe(parentTaskId);
}

async function dragHeader(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Task graph headers must have measurable bounds');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
}

test('menu picker and Task graph Alt-drag reparent atomically without changing dependencies', async ({
  page,
}) => {
  const { orgId } = await signUpAndOnboard(page, 'TaskHierarchy');
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('Onboarding produced no team');
  await apiJson(page, `/v1/orgs/${orgId}/settings/work-structure`, {
    method: 'PATCH',
    body: { initiativeMaxDepth: 3 },
  });

  const firstParentId = await createTask(page, orgId, teamId, 'Launch planning');
  const secondParentId = await createTask(page, orgId, teamId, 'Release operations');
  const childId = await createTask(page, orgId, teamId, 'Prepare rollout notes');
  const rootInitiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: { name: 'Transit access' },
  });
  const childInitiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: { name: 'Service planning' },
  });
  const grandchildInitiative = await apiJson<{ id: string }>(
    page,
    `/v1/orgs/${orgId}/initiatives`,
    { method: 'POST', body: { name: 'Frequent network' } },
  );
  const siblingInitiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: { name: 'Bus stop access' },
  });
  for (const [parentInitiativeId, childInitiativeId] of [
    [rootInitiative.id, childInitiative.id],
    [childInitiative.id, grandchildInitiative.id],
    [rootInitiative.id, siblingInitiative.id],
  ]) {
    await apiJson(page, `/v1/orgs/${orgId}/initiatives/hierarchy-links`, {
      method: 'POST',
      body: { parentInitiativeId, childInitiativeId },
    });
  }
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${childId}/dependencies`, {
    method: 'POST',
    body: { blockingTaskId: firstParentId },
  });

  await page.goto(orgHref(orgId, 'tasks'), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  const childRow = page.locator(`[data-object-kind="task"][data-object-id="${childId}"]`).first();
  await expect(childRow).toBeVisible({ timeout: TIMEOUTS.pageReady });
  const makeSubtaskItem = page.getByRole('menuitem', { name: 'Make subtask of…' });
  await expect(async () => {
    await childRow.dispatchEvent('contextmenu', { clientX: 420, clientY: 200 });
    await expect(makeSubtaskItem).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: TIMEOUTS.pageReady });
  await makeSubtaskItem.click();
  const parentOption = page.getByRole('option', { name: /Launch planning/ });
  await expect(parentOption).toBeVisible();
  if (process.env['CAPTURE_TASK_HIERARCHY_EVIDENCE'] === '1') {
    await page.screenshot({
      path: evidencePath('2026-08-23-object-relation-picker.png'),
      animations: 'disabled',
    });
  }
  await parentOption.getByRole('button').click();
  await expectParent(page, orgId, childId, firstParentId);

  await page.goto(orgHref(orgId, 'graph'), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByText('Task graph', { exact: true })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  const childHeader = page.locator(`.react-flow__node[data-id="${childId}"] .task-branch-header`);
  const firstParentHeader = page.locator(
    `.react-flow__node[data-id="${firstParentId}"] .task-branch-header`,
  );
  const secondParentHeader = page.locator(
    `.react-flow__node[data-id="${secondParentId}"] .task-branch-header`,
  );
  await expect(childHeader).toBeVisible();
  await expect(firstParentHeader).toBeVisible();
  await expect(secondParentHeader).toBeVisible();

  const childBox = await childHeader.boundingBox();
  const parentBox = await firstParentHeader.boundingBox();
  expect(childBox && parentBox ? childBox.x - parentBox.x : 0).toBeGreaterThan(40);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  await dragHeader(page, childHeader, secondParentHeader);
  await expectParent(page, orgId, childId, secondParentId);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  await expectParent(page, orgId, childId, secondParentId);

  await captureActiveDropEvidence(page, orgId, childId, firstParentId);
  await captureHierarchyEvidence(page, orgId);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  const graph = await apiJson<{
    edges: { kind: 'dependency' | 'subtask'; source: string; target: string }[];
  }>(page, `/v1/orgs/${orgId}/graph`);
  expect(
    graph.edges.some(
      (edge) =>
        edge.kind === 'dependency' && edge.source === firstParentId && edge.target === childId,
    ),
  ).toBe(true);
});
