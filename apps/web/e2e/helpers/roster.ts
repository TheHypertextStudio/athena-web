/** Shared fixtures and rendered-geometry assertions for work-roster browser acceptance. */
import type { Locator, Page } from '@playwright/test';

import { createMobileAuditFixture } from './mobile-audit-fixture';
import { apiJson } from './net';
import { expect } from './fixtures';

/** Long names that exercise the reported Initiative identity-column failures. */
export const ROSTER_LONG_TITLES = {
  root: 'Expand reliable regional transit access',
  child: 'Deliver safer crossings on every corridor',
  depthFive: 'Modernize accessible passenger information',
} as const;

/** Saved-view names used to switch deterministic list and density states. */
export const ROSTER_VIEWS = {
  task: 'Release tasks',
  project: 'Release projects',
  program: 'Release programs',
  initiativeCompact: 'Initiatives compact',
  initiativeComfortable: 'Initiatives comfortable',
  initiativeGrouped: 'Initiatives grouped',
  initiativeForeign: 'Initiatives cross-workspace',
} as const;

/** The seeded ids and labels required by deterministic and evidence-only roster specs. */
export interface WorkRosterFixture {
  readonly organizationId: string;
  readonly foreignOrganizationId: string;
  readonly teamId: string;
  readonly cycleId: string;
  readonly rootId: string;
  readonly onlyChildId: string;
  readonly grandchildId: string;
  readonly depthFourId: string;
  readonly depthFiveId: string;
  readonly laterSiblingId: string;
  readonly secondRootId: string;
  readonly foreignInitiativeId: string;
  readonly bulkTitles: readonly string[];
}

interface CreatedEntity {
  readonly id: string;
}

interface CreatedSavedView extends CreatedEntity {
  readonly name: string;
}

const INITIATIVE_PROPERTIES = [
  'status',
  'priority',
  'health',
  'owner',
  'leadTeam',
  'labels',
  'targetDate',
  'updateCadence',
  'latestUpdate',
  'parent',
  'organization',
] as const;

/** Create one Initiative through the authenticated API boundary. */
export async function createRosterInitiative(
  page: Page,
  organizationId: string,
  name: string,
  status = 'active',
): Promise<string> {
  const created = await apiJson<CreatedEntity>(page, `/v1/orgs/${organizationId}/initiatives`, {
    method: 'POST',
    body: { name, status },
  });
  return created.id;
}

/** Connect one Initiative child to its parent in the route workspace. */
export async function connectRosterInitiatives(
  page: Page,
  organizationId: string,
  parentInitiativeId: string,
  childInitiativeId: string,
): Promise<void> {
  await apiJson(page, `/v1/orgs/${organizationId}/initiatives/hierarchy-links`, {
    method: 'POST',
    body: { parentInitiativeId, childInitiativeId },
  });
}

/** Create rows in bounded batches so PostgreSQL and the API stay below the machine limits. */
async function createInitiativeBatch(
  page: Page,
  organizationId: string,
  names: readonly string[],
  status: string,
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let index = 0; index < names.length; index += 8) {
    const batch = names.slice(index, index + 8);
    ids.push(
      ...(await Promise.all(
        batch.map((name) => createRosterInitiative(page, organizationId, name, status)),
      )),
    );
  }
  return ids;
}

/** Persist one typed work roster view used by the responsive matrix. */
async function createRosterView(
  page: Page,
  organizationId: string,
  input: {
    readonly name: string;
    readonly position: string;
    readonly target: 'task' | 'project' | 'program' | 'initiative';
    readonly properties: readonly string[];
    readonly density: 'compact' | 'comfortable';
    readonly groupBy?: string | null;
    readonly context?:
      | { readonly kind: 'organization' }
      | { readonly kind: 'initiative'; readonly initiativeId: string };
  },
): Promise<CreatedSavedView> {
  return apiJson<CreatedSavedView>(page, `/v1/orgs/${organizationId}/saved-views`, {
    method: 'POST',
    body: {
      name: input.name,
      scope: 'organization',
      position: input.position,
      schemaVersion: 2,
      target: input.target,
      context: input.context ?? { kind: 'organization' },
      definition: {
        version: 2,
        target: input.target,
        filter: null,
        arrangement: { groupBy: input.groupBy ?? null, subGroupBy: null, orderBy: [] },
        presentation: {
          layout: 'list',
          properties: input.properties,
          density: input.density,
          showEmptyGroups: false,
        },
      },
    },
  });
}

/** Seed every route, hierarchy, continuation, and capability case used by Task 8. */
export async function seedWorkRosterFixture(
  page: Page,
  foreignOrganizationId: string,
): Promise<WorkRosterFixture> {
  const audit = await createMobileAuditFixture(page);
  const organizationId = audit.orgId;
  await apiJson(page, `/v1/orgs/${organizationId}/settings/work-structure`, {
    method: 'PATCH',
    body: { initiativeMaxDepth: 5 },
  });
  const rootId = await createRosterInitiative(
    page,
    organizationId,
    ROSTER_LONG_TITLES.root,
    'proposed',
  );
  const onlyChildId = await createRosterInitiative(
    page,
    organizationId,
    ROSTER_LONG_TITLES.child,
    'active',
  );
  const grandchildId = await createRosterInitiative(
    page,
    organizationId,
    'Coordinate the complete station accessibility program',
    'completed',
  );
  const depthFourId = await createRosterInitiative(
    page,
    organizationId,
    'Publish consistent wayfinding standards',
    'active',
  );
  const depthFiveId = await createRosterInitiative(
    page,
    organizationId,
    ROSTER_LONG_TITLES.depthFive,
    'completed',
  );
  const laterSiblingId = await createRosterInitiative(
    page,
    organizationId,
    'Restore late evening service',
    'canceled',
  );
  const secondRootId = await createRosterInitiative(
    page,
    organizationId,
    'Build a safe streets delivery program',
    'active',
  );
  const secondRootChildId = await createRosterInitiative(
    page,
    organizationId,
    'Protect crossings near every school',
    'completed',
  );

  for (const [parent, child] of [
    [rootId, onlyChildId],
    [onlyChildId, grandchildId],
    [grandchildId, depthFourId],
    [depthFourId, depthFiveId],
    [rootId, laterSiblingId],
    [secondRootId, secondRootChildId],
  ] as const) {
    await connectRosterInitiatives(page, organizationId, parent, child);
  }

  const bulkTitles = Array.from(
    { length: 101 },
    (_, index) => `Release acceptance Initiative ${String(index + 1).padStart(3, '0')}`,
  );
  await createInitiativeBatch(page, organizationId, bulkTitles, 'proposed');

  const foreignInitiativeId = await createRosterInitiative(
    page,
    foreignOrganizationId,
    'Foreign-owned readable Initiative',
    'active',
  );
  await connectRosterInitiatives(page, organizationId, secondRootId, foreignInitiativeId);

  await Promise.all([
    createRosterView(page, organizationId, {
      name: ROSTER_VIEWS.task,
      position: 'a0',
      target: 'task',
      properties: ['status', 'priority', 'assignee', 'dueDate'],
      density: 'compact',
    }),
    createRosterView(page, organizationId, {
      name: ROSTER_VIEWS.project,
      position: 'a1',
      target: 'project',
      properties: ['status', 'priority', 'health', 'lead', 'targetTimeframe', 'progress'],
      density: 'compact',
    }),
    createRosterView(page, organizationId, {
      name: ROSTER_VIEWS.program,
      position: 'a2',
      target: 'program',
      properties: ['status', 'health', 'owner', 'projectCount', 'taskCount'],
      density: 'compact',
    }),
    createRosterView(page, organizationId, {
      name: ROSTER_VIEWS.initiativeCompact,
      position: 'a3',
      target: 'initiative',
      properties: INITIATIVE_PROPERTIES,
      density: 'compact',
    }),
    createRosterView(page, organizationId, {
      name: ROSTER_VIEWS.initiativeComfortable,
      position: 'a4',
      target: 'initiative',
      properties: INITIATIVE_PROPERTIES,
      density: 'comfortable',
    }),
    createRosterView(page, organizationId, {
      name: ROSTER_VIEWS.initiativeGrouped,
      position: 'a5',
      target: 'initiative',
      properties: INITIATIVE_PROPERTIES,
      density: 'compact',
      groupBy: 'status',
    }),
    createRosterView(page, organizationId, {
      name: ROSTER_VIEWS.initiativeForeign,
      position: 'a6',
      target: 'initiative',
      properties: INITIATIVE_PROPERTIES,
      density: 'compact',
      context: { kind: 'initiative', initiativeId: secondRootId },
    }),
  ]);

  return {
    organizationId,
    foreignOrganizationId,
    teamId: audit.teamId,
    cycleId: audit.cycleId,
    rootId,
    onlyChildId,
    grandchildId,
    depthFourId,
    depthFiveId,
    laterSiblingId,
    secondRootId,
    foreignInitiativeId,
    bulkTitles,
  };
}

/** Select a saved roster tab whether it is visible in the clipped strip or only in overflow. */
export async function selectRosterView(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tab', { name, exact: true });
  if (await tab.isVisible()) {
    await tab.click();
  } else {
    await page.getByRole('button', { name: 'More view controls' }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Return the visible shared-table column keys in declaration order. */
export async function visibleRosterColumns(grid: Locator): Promise<readonly string[]> {
  return grid.locator('[role="columnheader"][data-col]:visible').evaluateAll((headers) =>
    headers.flatMap((header) => {
      const key = header.getAttribute('data-col');
      return key === null ? [] : [key];
    }),
  );
}

interface ColumnBox {
  readonly key: string;
  readonly headerX: number;
  readonly headerWidth: number;
  readonly cellX: number;
  readonly cellWidth: number;
}

/** Measure each visible header against the first rendered data row through `data-col`. */
async function rosterColumnBoxes(grid: Locator): Promise<readonly ColumnBox[]> {
  const row = grid.locator('[role="row"]:has([role="gridcell"])').first();
  await expect(row).toBeVisible();
  const keys = await visibleRosterColumns(grid);
  return Promise.all(
    keys.map(async (key) => {
      const header = grid.locator(`[role="columnheader"][data-col="${key}"]`);
      const cell = row.locator(`[role="gridcell"][data-col="${key}"]`);
      const [headerBox, cellBox] = await Promise.all([header.boundingBox(), cell.boundingBox()]);
      if (headerBox === null || cellBox === null) throw new Error(`Column ${key} has no box.`);
      return {
        key,
        headerX: headerBox.x,
        headerWidth: headerBox.width,
        cellX: cellBox.x,
        cellWidth: cellBox.width,
      };
    }),
  );
}

/** Assert shared header/body geometry before and after local horizontal scrolling. */
export async function expectRosterColumnGeometry(grid: Locator): Promise<void> {
  for (const scrollLeft of [0, 160]) {
    await grid.evaluate((element, left) => {
      element.scrollLeft = Math.min(left, element.scrollWidth - element.clientWidth);
      element.dispatchEvent(new Event('scroll'));
    }, scrollLeft);
    for (const box of await rosterColumnBoxes(grid)) {
      expect(Math.abs(box.headerX - box.cellX), `${box.key} x alignment`).toBeLessThanOrEqual(1);
      expect(
        Math.abs(box.headerWidth - box.cellWidth),
        `${box.key} width alignment`,
      ).toBeLessThanOrEqual(1);
    }
  }
}

/** Assert the Initiative label, root title, depth indent, and minimum text floors. */
export async function expectInitiativeIdentityGeometry(
  grid: Locator,
  fixture: WorkRosterFixture,
): Promise<void> {
  const headerLabel = grid.getByText('Initiative', { exact: true }).first();
  const rootTitle = grid.getByRole('link', { name: ROSTER_LONG_TITLES.root }).first();
  const childTitle = grid.getByRole('link', { name: ROSTER_LONG_TITLES.child }).first();
  const depthFiveTitle = grid.getByRole('link', { name: ROSTER_LONG_TITLES.depthFive }).first();
  await expect(rootTitle).toBeVisible();
  const [headerBox, rootBox, childBox, depthFiveBox] = await Promise.all([
    headerLabel.boundingBox(),
    rootTitle.boundingBox(),
    childTitle.boundingBox(),
    depthFiveTitle.boundingBox(),
  ]);
  if (!headerBox || !rootBox || !childBox || !depthFiveBox) {
    throw new Error('Initiative identity geometry is not measurable.');
  }
  expect(Math.abs(headerBox.x - rootBox.x), 'header label and root title x').toBeLessThanOrEqual(1);
  expect(Math.abs(childBox.x - rootBox.x), 'one Initiative depth').toBeGreaterThanOrEqual(23);
  expect(Math.abs(childBox.x - rootBox.x), 'one Initiative depth').toBeLessThanOrEqual(25);

  const rootCell = grid
    .locator(`[data-row-id="${fixture.rootId}"] [role="gridcell"][data-col="identity"]`)
    .first();
  const depthFiveCell = grid
    .locator(`[data-row-id="${fixture.depthFiveId}"] [role="gridcell"][data-col="identity"]`)
    .first();
  const [gridBox, rootCellBox, depthFiveCellBox] = await Promise.all([
    grid.boundingBox(),
    rootCell.boundingBox(),
    depthFiveCell.boundingBox(),
  ]);
  if (!gridBox || !rootCellBox || !depthFiveCellBox) {
    throw new Error('Initiative identity cells are missing.');
  }
  if (gridBox.width >= 376) {
    expect(
      rootCellBox.x + rootCellBox.width - rootBox.x,
      'root title floor',
    ).toBeGreaterThanOrEqual(307);
    expect(
      depthFiveCellBox.x + depthFiveCellBox.width - depthFiveBox.x,
      'depth-five title floor',
    ).toBeGreaterThanOrEqual(211);
  }
}

/** Assert that each required long Initiative title fits inside its visible text box. */
export async function expectInitiativeTitlesFit(grid: Locator): Promise<void> {
  for (const title of Object.values(ROSTER_LONG_TITLES)) {
    const link = grid.getByRole('link', { name: title }).first();
    await expect(link).toBeVisible();
    const titleBox = link.locator('[data-roster-title]');
    const width = await titleBox.evaluate((element) => ({
      visible: element.clientWidth,
      content: element.scrollWidth,
    }));
    expect(width.content, `${title} content width`).toBeLessThanOrEqual(width.visible);
  }
}

/** Assert that roster scrolling never escapes into document-level horizontal overflow. */
export async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
}

/** Assert one saved density drives row height and the Initiative rail elbow together. */
export async function expectInitiativeDensity(
  grid: Locator,
  rowId: string,
  expectedHeight: 44 | 56,
): Promise<void> {
  const row = grid.locator(`[data-row-id="${rowId}"]`).first();
  await expect(row).toHaveAttribute('data-row-height', String(expectedHeight));
  const box = await row.boundingBox();
  if (!box) throw new Error('Initiative density row is not measurable.');
  expect(Math.abs(box.height - expectedHeight)).toBeLessThanOrEqual(1);
  const path = row.getByTestId('initiative-hierarchy-rail').locator('path').first();
  const d = await path.getAttribute('d');
  expect(d).not.toBeNull();
  const numbers = d?.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
  expect(numbers.includes(expectedHeight / 2), 'rail elbow center').toBe(true);
}

/** Assert one grid owns horizontal overflow while a one-column mobile roster does not scroll. */
export async function expectRosterScrollOwnership(
  page: Page,
  grid: Locator,
  shouldScroll: boolean,
): Promise<void> {
  const sizes = await grid.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  if (shouldScroll) expect(sizes.scroll).toBeGreaterThan(sizes.client);
  else expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
  await expectNoDocumentOverflow(page);
}

/** Assert that vertical virtualization leaves the shared header sticky inside its scrollport. */
export async function expectStickyRosterHeader(grid: Locator): Promise<void> {
  const header = grid.locator('[role="row"]').first();
  const before = await header.boundingBox();
  await grid.evaluate((element) => {
    element.scrollTop = Math.min(1200, element.scrollHeight - element.clientHeight);
    element.dispatchEvent(new Event('scroll'));
  });
  const after = await header.boundingBox();
  if (!before || !after) throw new Error('Roster header is not measurable.');
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
}

/** Create a backup Owner and downgrade the signed-in actor to a view-only custom role. */
export async function makeCurrentRosterActorViewer(
  page: Page,
  organizationId: string,
): Promise<void> {
  const roles = await apiJson<{
    items: readonly { readonly id: string; readonly key: string }[];
  }>(page, `/v1/orgs/${organizationId}/roles`);
  const ownerRoleId = roles.items.find(({ key }) => key === 'owner')?.id;
  if (!ownerRoleId) throw new Error('The shared workspace has no Owner role.');
  await apiJson(page, `/v1/orgs/${organizationId}/members`, {
    method: 'POST',
    body: { displayName: 'Release acceptance backup owner', roleId: ownerRoleId },
  });
  const viewerRole = await apiJson<CreatedEntity>(page, `/v1/orgs/${organizationId}/roles`, {
    method: 'POST',
    body: {
      key: `release-viewer-${Date.now()}`,
      name: 'Release viewer',
      capabilities: ['view'],
      baseCapability: 'view',
      defaultVisibility: 'public',
    },
  });
  const members = await apiJson<{
    items: readonly { readonly actorId: string; readonly userId: string | null }[];
  }>(page, `/v1/orgs/${organizationId}/members`);
  const current = members.items.find(({ userId }) => userId !== null);
  if (!current) throw new Error('The signed-in workspace Actor is missing.');
  await apiJson(page, `/v1/orgs/${organizationId}/members/${current.actorId}`, {
    method: 'PATCH',
    body: { roleId: viewerRole.id },
  });
}
