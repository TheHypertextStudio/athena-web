import { randomUUID } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch } from '../helpers/net';

/**
 * The Project dependencies page: its own URL, an edge-to-edge canvas, an edge that appears before
 * the server answers, and the way back to the roster.
 */

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** POST `path` and return the created row's id, failing unless the API creates a resource. */
async function createProject(page: Page, orgId: string, name: string): Promise<string> {
  const result = await apiFetch(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name },
  });
  expect(result.status, `creating ${name}`).toBe(201);
  return (result.body as { id: string }).id;
}

/** Make `blockingId` block `blockedId` through the same command the canvas posts. */
async function addDependency(
  page: Page,
  orgId: string,
  blockingId: string,
  blockedId: string,
): Promise<void> {
  const commandId = randomUUID();
  const result = await apiFetch(page, `/v1/orgs/${orgId}/object-commands`, {
    method: 'POST',
    headers: { 'Idempotency-Key': commandId },
    body: {
      commandId,
      objectKind: 'project',
      objectIds: [blockingId, blockedId],
      operation: { type: 'add_dependency', blockingId, blockedId },
    },
  });
  expect(result.ok, 'seeding a dependency').toBe(true);
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('Expected the element to be rendered.');
  return box;
}

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

/** A node's position on the canvas, as the transform xyflow writes on it. */
async function transformOf(page: Page, projectId: string): Promise<string> {
  const node = page.locator(`.react-flow__node[data-id="${projectId}"]`);
  return node.evaluate((element) => (element as HTMLElement).style.transform);
}

/** A node's translation, read from the transform xyflow writes on it. */
async function positionOf(page: Page, projectId: string): Promise<{ x: number; y: number }> {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(await transformOf(page, projectId));
  if (match === null) throw new Error(`No translation on the node for ${projectId}.`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** Wait until a node has stopped moving, so a later comparison starts from a settled layout. */
async function settle(page: Page, projectIds: readonly string[]): Promise<void> {
  let previous = '';
  await expect
    .poll(
      async () => {
        const current = (
          await Promise.all(projectIds.map((projectId) => transformOf(page, projectId)))
        ).join('|');
        const stable = current !== '' && current === previous;
        previous = current;
        return stable;
      },
      { intervals: [400], timeout: TIMEOUTS.ui },
    )
    .toBe(true);
}

/** The centre of a project's connection handle. */
async function handleCentre(
  page: Page,
  projectId: string,
  side: 'source' | 'target',
): Promise<{ x: number; y: number }> {
  const handle = page.locator(
    `.react-flow__node[data-id="${projectId}"] .react-flow__handle.${side}`,
  );
  const box = await boxOf(handle);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('the Project dependencies page is a full-page canvas with an optimistic edge', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const { orgId } = await signUpAndOnboard(page, 'ProjectDependencies');

  // Two linked projects, and three that stand alone.
  const blocker = await createProject(page, orgId, 'Platform rebuild');
  const blocked = await createProject(page, orgId, 'Billing migration');
  const upstream = await createProject(page, orgId, 'Search relevance');
  const downstream = await createProject(page, orgId, 'Onboarding revamp');
  const bystander = await createProject(page, orgId, 'Status page');
  await addDependency(page, orgId, blocker, blocked);
  const everyProject = [blocker, blocked, upstream, downstream, bystander];

  await test.step('lives at its own URL and fills its container', async () => {
    await page.goto(orgHref(orgId, 'projects/dependencies'), {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.pageReady,
    });
    await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/projects/dependencies$`));
    await expect(page.locator('.react-flow__node')).toHaveCount(everyProject.length, {
      timeout: TIMEOUTS.pageReady,
    });
    await settle(page, everyProject);

    const viewport = page.getByTestId('canvas-viewport');
    const viewportBox = await boxOf(viewport);
    const containerBox = await boxOf(viewport.locator('xpath=..'));
    expect(Math.abs(viewportBox.height - containerBox.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(viewportBox.width - containerBox.width)).toBeLessThanOrEqual(1);

    // The minimap and the view controls float over the canvas instead of shrinking it.
    const minimap = page.locator('.react-flow__minimap');
    const toolbar = page.getByRole('toolbar', { name: 'Canvas view controls' });
    await expect(minimap).toBeVisible();
    await expect(toolbar).toBeVisible();
    expect(inside(await boxOf(minimap), viewportBox)).toBe(true);
    expect(inside(await boxOf(toolbar), viewportBox)).toBe(true);
    // The floating bar sits over the top of the same viewport too.
    const bar = page.getByRole('region', { name: 'Project dependencies' });
    expect(inside(await boxOf(bar), viewportBox)).toBe(true);
  });

  await test.step('draws a dragged edge before the server answers, leaving other components in place', async () => {
    let releaseCommand: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    await page.route(/\/v1\/orgs\/[^/]+\/object-commands$/, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await gate;
      await route.continue();
    });
    const commandPosted = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/object-commands'),
    );
    const commandAnswered = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/object-commands'),
    );

    const edge = page.locator(`.react-flow__edge[data-id="${upstream}->${downstream}"]`);
    await expect(edge).toHaveCount(0);
    const bystanderBefore = await transformOf(page, bystander);
    const [blockerAt, blockedAt] = await Promise.all(
      [blocker, blocked].map((id) => positionOf(page, id)),
    );
    const linkedOffset = { x: blockedAt.x - blockerAt.x, y: blockedAt.y - blockerAt.y };
    const from = await handleCentre(page, upstream, 'source');
    const to = await handleCentre(page, downstream, 'target');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    // The command is held at the gate, so an edge on screen came from the optimistic patch alone.
    await commandPosted;
    await expect(edge).toHaveCount(1);
    await page.waitForTimeout(600);
    await expect(edge).toHaveCount(1);
    // The component ahead of the change does not move at all.
    expect(await transformOf(page, bystander)).toBe(bystanderBefore);
    // The linked pair behind it slides as one piece: its inner layout is not recomputed.
    const linkedAfter = await Promise.all([blocker, blocked].map((id) => positionOf(page, id)));
    expect(linkedAfter[1]?.x).toBe((linkedAfter[0]?.x ?? 0) + linkedOffset.x);
    expect(linkedAfter[1]?.y).toBe((linkedAfter[0]?.y ?? 0) + linkedOffset.y);

    releaseCommand();
    const answered = await commandAnswered;
    expect(answered.ok()).toBe(true);
    await expect(edge).toHaveCount(1);
    await page.unroute(/\/v1\/orgs\/[^/]+\/object-commands$/);
  });

  await test.step('keeps Projects highlighted in the expanded sidebar', async () => {
    // The page asks the sidebar for its icon rail on a window this wide; open it back out.
    const expand = page.getByRole('button', { name: 'Expand navigation' });
    if (await expand.isVisible()) await expand.click();
    const projects = page.getByRole('link', { name: 'Projects', exact: true });
    await expect(projects).toHaveCount(1);
    await expect(projects).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('link', { name: 'Tasks', exact: true }).first(),
    ).not.toHaveAttribute('aria-current', 'page');
  });

  await test.step('returns to the roster from the way back', async () => {
    await page.getByRole('link', { name: /back to projects/i }).click();
    await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/projects$`));
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page.getByText('Platform rebuild')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Dependencies' })).toBeVisible();
  });
});
