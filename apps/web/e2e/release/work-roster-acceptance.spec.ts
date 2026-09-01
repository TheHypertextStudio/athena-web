/** Production-build acceptance for shared work-roster layout, paging, and interaction contracts. */
import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import {
  expectInitiativeDensity,
  expectInitiativeIdentityGeometry,
  expectInitiativeTitlesFit,
  expectNoDocumentOverflow,
  expectRosterColumnGeometry,
  expectRosterScrollOwnership,
  expectStickyRosterHeader,
  makeCurrentRosterActorViewer,
  ROSTER_LONG_TITLES,
  ROSTER_VIEWS,
  seedWorkRosterFixture,
  selectRosterView,
  visibleRosterColumns,
  type WorkRosterFixture,
} from '../helpers/roster';

const WORK_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1016, height: 1724 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 844 },
] as const;

const ADAPTER_VIEWPORTS = [
  { width: 1016, height: 900 },
  { width: 390, height: 844 },
] as const;

const ROUTES = [
  { route: 'tasks', heading: 'Tasks', grid: 'Tasks', view: ROSTER_VIEWS.task, role: 'grid' },
  {
    route: 'projects',
    heading: 'Projects',
    grid: 'Projects',
    view: ROSTER_VIEWS.project,
    role: 'grid',
  },
  {
    route: 'programs',
    heading: 'Programs',
    grid: 'Programs',
    view: ROSTER_VIEWS.program,
    role: 'grid',
  },
  {
    route: 'initiatives',
    heading: 'Initiatives',
    grid: 'Initiatives',
    view: ROSTER_VIEWS.initiativeCompact,
    role: 'treegrid',
  },
] as const;

/** Open one typed saved-view roster and wait for its real shared table. */
async function openWorkRoster(
  page: Page,
  organizationId: string,
  entry: (typeof ROUTES)[number],
): Promise<Locator> {
  await page.goto(orgHref(organizationId, entry.route), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: entry.heading })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await selectRosterView(page, entry.view);
  const grid = page.getByRole(entry.role, { name: entry.grid }).first();
  await expect(grid).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await expect(grid.locator('[role="row"]:has([role="gridcell"])').first()).toBeVisible();
  return grid;
}

interface RosterColumnSample {
  readonly containerWidth: number;
  readonly columns: readonly string[];
}

/** Measure the visible columns against the container width that drives their CSS queries. */
async function sampleRosterColumns(grid: Locator): Promise<RosterColumnSample> {
  return {
    containerWidth: await grid.evaluate((element) => element.clientWidth),
    columns: await visibleRosterColumns(grid),
  };
}

/** Assert that every narrower table's visible columns are a subset of the next wider table. */
function expectMonotonicColumns(samples: readonly RosterColumnSample[]): void {
  const ascending = [...samples].sort((left, right) => left.containerWidth - right.containerWidth);
  for (let index = 1; index < ascending.length; index += 1) {
    const narrower = ascending[index - 1];
    const wider = ascending[index];
    if (narrower === undefined || wider === undefined) continue;
    const widerColumns = new Set(wider.columns);
    for (const key of narrower.columns) {
      expect(
        widerColumns.has(key),
        `${key} must remain visible from ${String(narrower.containerWidth)}px to ${String(wider.containerWidth)}px`,
      ).toBe(true);
    }
  }
}

/** Return the first rendered table on Team or Cycle adapter routes. */
async function openAdapter(
  page: Page,
  fixture: WorkRosterFixture,
  route: 'teams' | 'cycles',
): Promise<Locator> {
  const routePath = route === 'teams' ? 'teams?layout=list' : route;
  await page.goto(orgHref(fixture.organizationId, routePath), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(
    page.getByRole('heading', { name: route === 'teams' ? 'Teams' : 'Cycles' }),
  ).toBeVisible({ timeout: TIMEOUTS.pageReady });
  const grid = page.getByRole('grid').first();
  await expect(grid).toBeVisible();
  return grid;
}

/** Exercise keyboard movement, selection, and Enter activation through the one grid owner. */
async function exerciseKeyboard(
  page: Page,
  grid: Locator,
  fixture: WorkRosterFixture,
): Promise<void> {
  await grid.focus();
  await page.keyboard.press('ArrowDown');
  const activeId = await grid.getAttribute('aria-activedescendant');
  expect(activeId).toBeTruthy();
  await page.keyboard.press('Space');
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toHaveCount(0);

  await grid.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/initiatives\//u);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('treegrid', { name: 'Initiatives' })).toBeVisible();
  await expect(page.getByRole('link', { name: ROSTER_LONG_TITLES.root }).first()).toBeVisible();
  expect(fixture.rootId).toBeTruthy();
}

/** Advance one virtualized grid until its requested tail entry is mounted and visible. */
async function revealAtVirtualEnd(grid: Locator, target: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        await grid.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
          element.dispatchEvent(new Event('scroll'));
        });
        return target.count();
      },
      { timeout: TIMEOUTS.pageReady },
    )
    .toBeGreaterThan(0);
  await expect(target).toBeVisible();
}

/** Return one virtualized grid to its first mounted rows. */
async function revealAtVirtualStart(grid: Locator, target: Locator): Promise<void> {
  await grid.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(target).toBeVisible({ timeout: TIMEOUTS.pageReady });
}

/** Drive the roster's DnD Kit pointer sensor through activation, acceptance, and release. */
async function dragRosterRow(page: Page, source: Locator, target: Locator): Promise<void> {
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  if (!sourceBox || !targetBox) throw new Error('Roster drag rows are not measurable.');
  const from = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const to = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < 8) throw new Error('Roster drag source and target overlap.');
  const activation = {
    x: from.x + ((to.x - from.x) / distance) * 8,
    y: from.y + ((to.y - from.y) / distance) * 8,
  };
  let pointerDown = false;
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    pointerDown = true;
    await page.mouse.move(activation.x, activation.y, { steps: 2 });
    await expect(source).toHaveAttribute('data-drag-state', 'dragging');
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await expect(target).toHaveAttribute('data-drop-state', 'accept');
    await page.mouse.up();
    pointerDown = false;
    await expect(source).toHaveAttribute('data-drag-state', 'idle');
  } finally {
    if (pointerDown) await page.mouse.up();
  }
}

/** Prove a failed group continuation retains rows and retries only its owning path. */
async function exerciseGroupRecovery(page: Page, fixture: WorkRosterFixture): Promise<Locator> {
  let rejectContinuation = true;
  await page.route(`**/v1/orgs/${fixture.organizationId}/work-views/query`, async (route) => {
    const body = route.request().postDataJSON() as {
      readonly cursor?: string | null;
      readonly groupPath?: readonly string[];
    };
    if (rejectContinuation && body.cursor && body.groupPath?.[0] === 'proposed') {
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://docket.hypertext.studio/problems/unavailable',
          title: 'Unavailable',
          status: 503,
          code: 'unavailable',
        }),
      });
      return;
    }
    await route.continue();
  });
  await selectRosterView(page, ROSTER_VIEWS.initiativeGrouped);
  const grid = page.getByRole('treegrid', { name: 'Initiatives' });
  const rootOccurrences = grid.getByRole('link', { name: ROSTER_LONG_TITLES.root });
  await expect
    .poll(() => rootOccurrences.count(), { timeout: TIMEOUTS.pageReady })
    .toBeGreaterThanOrEqual(2);
  const loadedBefore = await grid.getAttribute('aria-rowcount');
  const loadMore = grid.getByRole('button', { name: /Load more Proposed/iu });
  await revealAtVirtualEnd(grid, loadMore);
  await loadMore.click();
  const retry = grid.getByRole('button', { name: /Retry Proposed/iu });
  await expect(retry).toBeVisible();
  expect(await grid.getAttribute('aria-rowcount')).toBe(loadedBefore);
  rejectContinuation = false;
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(grid.getByText(fixture.bulkTitles.at(-1) ?? '')).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.unroute(`**/v1/orgs/${fixture.organizationId}/work-views/query`);
  return grid;
}

test('shared work rosters pass the release geometry and interaction contract', async ({ page }) => {
  test.setTimeout(1_200_000);
  const { orgId: personalOrganizationId } = await signUpAndOnboard(page, 'RosterRelease');
  const fixture = await seedWorkRosterFixture(page, personalOrganizationId);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  page.setDefaultTimeout(TIMEOUTS.ui);

  for (const entry of ROUTES) {
    const grid = await openWorkRoster(page, fixture.organizationId, entry);
    const columnSamples: RosterColumnSample[] = [];
    for (const viewport of WORK_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(grid).toBeVisible();
      await expectRosterColumnGeometry(grid);
      await expectNoDocumentOverflow(page);
      columnSamples.push(await sampleRosterColumns(grid));
      if (viewport.width === 320) await expectRosterScrollOwnership(page, grid, false);
    }
    expectMonotonicColumns(columnSamples);
  }

  for (const route of ['teams', 'cycles'] as const) {
    await page.setViewportSize(ADAPTER_VIEWPORTS[0]);
    const grid = await openAdapter(page, fixture, route);
    const samples: RosterColumnSample[] = [];
    for (const viewport of ADAPTER_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expectRosterColumnGeometry(grid);
      await expectNoDocumentOverflow(page);
      samples.push(await sampleRosterColumns(grid));
    }
    expectMonotonicColumns(samples);
  }

  await page.setViewportSize({ width: 1016, height: 1724 });
  const initiativeGrid = await openWorkRoster(page, fixture.organizationId, ROUTES[3]);
  await expectRosterColumnGeometry(initiativeGrid);
  await expectInitiativeIdentityGeometry(initiativeGrid, fixture);
  await expectInitiativeTitlesFit(initiativeGrid);
  await expectInitiativeDensity(initiativeGrid, fixture.onlyChildId, 44);
  const openNavigation = page.getByRole('button', { name: 'Open navigation' });
  await expect(openNavigation).toBeVisible();
  await openNavigation.click();
  const navigation = page.getByRole('dialog', { name: 'Navigation' });
  await expect(navigation).toBeVisible();
  const drawerBackgroundGrid = page.locator('[role="treegrid"][aria-label="Initiatives"]').first();
  await expectRosterColumnGeometry(drawerBackgroundGrid);
  await expectInitiativeTitlesFit(drawerBackgroundGrid);
  await page.keyboard.press('Escape');
  await expect(navigation).toBeHidden();
  await expectRosterColumnGeometry(initiativeGrid);
  await expectInitiativeTitlesFit(initiativeGrid);
  await selectRosterView(page, ROSTER_VIEWS.initiativeComfortable);
  await expectInitiativeDensity(initiativeGrid, fixture.onlyChildId, 56);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectInitiativeDensity(initiativeGrid, fixture.onlyChildId, 56);
  await selectRosterView(page, ROSTER_VIEWS.initiativeCompact);
  await expectInitiativeDensity(initiativeGrid, fixture.onlyChildId, 44);
  await expectInitiativeIdentityGeometry(initiativeGrid, fixture);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectRosterScrollOwnership(page, initiativeGrid, true);
  await expectStickyRosterHeader(initiativeGrid);
  await exerciseKeyboard(page, initiativeGrid, fixture);
  await exerciseGroupRecovery(page, fixture);
  await selectRosterView(page, ROSTER_VIEWS.initiativeCompact);

  const newTitle = 'Created while the Initiative roster stays mounted';
  await page.getByRole('button', { name: 'New initiative' }).click();
  const createDialog = page.getByRole('dialog', { name: 'New initiative' });
  await createDialog.getByRole('textbox', { name: 'Initiative name' }).fill(newTitle);
  await createDialog.getByRole('switch', { name: 'Create more' }).click();
  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/initiatives') &&
      response.request().method() === 'POST' &&
      response.status() === 201,
  );
  await createDialog.getByRole('button', { name: 'Create Initiative' }).click();
  await createResponse;
  await page.keyboard.press('Escape');
  const rootContinuation = initiativeGrid.getByRole('button', { name: 'Load more Initiatives' });
  await revealAtVirtualEnd(initiativeGrid, rootContinuation);
  await rootContinuation.click();
  await revealAtVirtualEnd(initiativeGrid, page.getByRole('link', { name: newTitle }));

  const renamed = `${ROSTER_LONG_TITLES.child} renamed`;
  const childLink = page.getByRole('link', { name: ROSTER_LONG_TITLES.child }).first();
  await revealAtVirtualStart(initiativeGrid, childLink);
  const mountedGrid = await initiativeGrid.elementHandle();
  if (mountedGrid === null) throw new Error('The mounted Initiative treegrid is missing.');
  const detailPage = await page.context().newPage();
  await detailPage.goto(orgHref(fixture.organizationId, `initiatives/${fixture.onlyChildId}`), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  const titleEditor = detailPage.getByRole('textbox', { name: 'Initiative name' });
  await titleEditor.fill(renamed);
  const renamedResponse = detailPage.waitForResponse(
    (response) =>
      response.url().endsWith(`/initiatives/${fixture.onlyChildId}`) &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  );
  const rosterRefresh = page.waitForResponse(
    (response) =>
      response.url().endsWith('/work-views/query') &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await titleEditor.press('Enter');
  await renamedResponse;
  await rosterRefresh;
  await detailPage.close();
  await page.bringToFront();
  await revealAtVirtualStart(initiativeGrid, page.getByRole('link', { name: renamed }).first());
  const currentGrid = await initiativeGrid.elementHandle();
  if (currentGrid === null) throw new Error('The Initiative treegrid unmounted during rename.');
  expect(
    await mountedGrid.evaluate((original, current) => original === current, currentGrid),
    'rename must retain the original treegrid DOM node',
  ).toBe(true);

  const laterRow = page.locator(`[data-row-id="${fixture.laterSiblingId}"]`).first();
  const renamedRow = page.locator(`[data-row-id="${fixture.onlyChildId}"]`).first();
  await expect(laterRow).not.toHaveAttribute('data-context-row', 'true');
  await expect(renamedRow).not.toHaveAttribute('data-context-row', 'true');
  const dragged = page.waitForResponse(
    (response) =>
      response.url().includes('/initiatives/hierarchy-links/') &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  );
  await dragRosterRow(page, laterRow, renamedRow);
  await dragged;
  await expect(laterRow).toHaveAttribute('aria-level', '3', { timeout: TIMEOUTS.pageReady });

  await laterRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Change parent…' }).click();
  const parentPicker = page.getByRole('listbox', { name: 'Parent initiative' });
  await parentPicker.getByRole('option', { name: 'Build a safe streets delivery program' }).click();
  await expect(laterRow).toHaveAttribute('aria-level', '2', { timeout: TIMEOUTS.pageReady });

  await selectRosterView(page, ROSTER_VIEWS.initiativeForeign);
  const foreignGrid = page.getByRole('treegrid', { name: 'Initiatives' });
  const foreignRow = foreignGrid.locator(`[data-row-id="${fixture.foreignInitiativeId}"]`).first();
  await expect(foreignRow).toHaveAttribute('data-object-action-scope', 'reference');
  await expect(foreignRow.getByRole('checkbox')).toHaveCount(0);
  await expect(foreignRow).not.toHaveClass(/cursor-grab/u);
  await foreignRow.focus();
  await foreignRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain(`/orgs/${fixture.foreignOrganizationId}/initiatives/${fixture.foreignInitiativeId}`);

  await makeCurrentRosterActorViewer(page, fixture.organizationId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'New initiative' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: `Select ${renamed}` })).toHaveCount(0);
  await expect(page.locator('[data-object-kind="initiative"]').first()).not.toHaveClass(
    /cursor-grab/u,
  );
});
