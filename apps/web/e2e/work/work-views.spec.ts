import type { Locator, Page } from '@playwright/test';

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

const CONTROL_CASES = {
  tasks: {
    filterField: 'title',
    filterLabel: 'Title',
    subgroup: 'priority',
    secondSort: 'Priority',
  },
  projects: {
    filterField: 'name',
    filterLabel: 'Name',
    subgroup: 'priority',
    secondSort: 'Priority',
  },
  programs: {
    filterField: 'name',
    filterLabel: 'Name',
    subgroup: 'health',
    secondSort: 'Health',
  },
  initiatives: {
    filterField: 'name',
    filterLabel: 'Name',
    subgroup: 'priority',
    secondSort: 'Priority',
  },
} as const;

async function openOverflowControl(page: Page, label: string): Promise<void> {
  const visibleControl = page.getByRole('button', { name: label, exact: true });
  if (await visibleControl.isVisible()) {
    await visibleControl.click();
    return;
  }
  await page.getByRole('button', { name: 'More view controls' }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

/** Wait for the server-executed roster query produced by one view-state change. */
function waitForViewQuery(page: Page): ReturnType<Page['waitForResponse']> {
  return page.waitForResponse(
    (response) =>
      response.url().includes('/work-views/query') &&
      response.request().method() === 'POST' &&
      response.ok(),
    { timeout: TIMEOUTS.pageReady },
  );
}

/** Open the ordered-sort editor from either its direct trigger or the single overflow surface. */
async function openSortEditor(page: Page): Promise<Locator> {
  const dialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByText('Sort view', { exact: true }) });
  if (await dialog.isVisible()) return dialog;
  const menu = page.getByRole('menu', { name: 'Sort' });
  if (await menu.isVisible()) return menu;
  const trigger = page.getByRole('button', { name: 'Sort', exact: true });
  if (await trigger.isVisible()) {
    await page.getByRole('button', { name: 'Sort' }).click();
    await expect(menu).toBeVisible();
    return menu;
  }
  await openOverflowControl(page, 'Sort');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Apply one executable nested text filter through the advanced editor. */
async function applyNestedFilter(
  page: Page,
  route: keyof typeof CONTROL_CASES,
  value: string,
): Promise<void> {
  const { filterField, filterLabel } = CONTROL_CASES[route];
  await page.getByRole('button', { name: 'Filter' }).click();
  const builder = page.getByRole('dialog', { name: `Filter ${route}` });
  await builder.getByRole('button', { name: filterLabel, exact: true }).click();
  await builder.getByRole('textbox', { name: 'Filter value' }).fill(value);
  await expect(builder.getByRole('combobox', { name: 'Filter field' }).first()).toHaveValue(
    filterField,
  );
  await builder.getByRole('button', { name: 'Add group to root filter group' }).click();
  await builder.getByRole('combobox', { name: 'Filter field' }).nth(1).selectOption(filterField);
  await builder.getByRole('textbox', { name: 'Filter value' }).nth(1).fill(value);
  const queried = waitForViewQuery(page);
  await builder.getByRole('button', { name: 'Apply filter' }).click();
  await queried;
}

/** Apply nested grouping and two ordered sort terms through the shared toolbar. */
async function arrangeRoster(page: Page, route: keyof typeof CONTROL_CASES): Promise<void> {
  const { filterLabel, subgroup, secondSort } = CONTROL_CASES[route];
  await openOverflowControl(page, 'Group');
  const groupDialog = page.getByRole('dialog', { name: 'Group view' });
  const groupBy = groupDialog.getByRole('combobox', { name: 'Group by', exact: true });
  await groupBy.selectOption('status');
  await expect(groupBy).toHaveValue('status');
  const subgrouped = waitForViewQuery(page);
  await groupDialog
    .getByRole('combobox', { name: 'Subgroup by', exact: true })
    .selectOption(subgroup);
  await subgrouped;
  await page.keyboard.press('Escape');
  await expect(groupDialog).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked', /\d+/);

  for (const field of [filterLabel, secondSort]) {
    const sort = await openSortEditor(page);
    await sort.getByRole('button', { name: 'Add sort' }).click();
    const sorted = waitForViewQuery(page);
    await page
      .getByRole('menu', { name: 'Add sort' })
      .getByRole('menuitem', { name: field, exact: true })
      .click();
    await sorted;
  }
  const sort = await openSortEditor(page);
  const ordered = sort.getByRole('list', { name: 'Ordered sort terms' });
  await expect(ordered).toContainText(`1. ${filterLabel}`);
  await expect(ordered).toContainText(`2. ${secondSort}`);
  await page.keyboard.press('Escape');
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
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  page.setDefaultTimeout(TIMEOUTS.ui);

  const rosters = [
    ['tasks', 'Tasks', 'Map ten-minute service'],
    ['projects', 'Projects', 'Frequent network'],
    ['programs', 'Programs', 'Service planning'],
    ['initiatives', 'Initiatives', 'Transit access'],
  ] as const;

  for (const [route, title, row] of rosters) {
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

  for (const [route, title, row] of rosters) {
    await page.goto(orgHref(orgId, route), { waitUntil: 'domcontentloaded' });
    await applyNestedFilter(page, route, row);
    await arrangeRoster(page, route);
    await expect(page.getByText(row, { exact: true })).toBeVisible();
    const viewName = `${title} shared`;
    await openOverflowControl(page, 'Save as new view');
    const saveDialog = page.getByRole('dialog', { name: 'Save view' });
    await saveDialog.getByRole('textbox', { name: 'View name' }).fill(viewName);
    await saveDialog.getByRole('combobox', { name: 'Share with' }).selectOption('organization');
    await saveDialog.getByRole('button', { name: 'Save view' }).click();

    const savedTab = page.getByRole('tab', { name: viewName });
    await expect(savedTab).toBeVisible();
    const saved = await apiJson<{ items: { name: string; scope: string }[] }>(
      page,
      `/v1/orgs/${orgId}/saved-views`,
    );
    expect(saved.items.find((view) => view.name === viewName)?.scope).toBe('organization');
    await savedTab.click();

    const favorite = page.getByRole('button', { name: `Add ${viewName} to favorites` });
    await favorite.click();
    await expect(
      page.getByRole('button', { name: `Remove ${viewName} from favorites` }),
    ).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('checkbox', { name: `Select ${row}` }).click();
    const bulkActions = page.getByRole('toolbar', { name: 'Bulk actions' });
    await expect(bulkActions).toBeVisible();
    await bulkActions.getByRole('button', { name: 'Copy links' }).click();
    await expect(bulkActions.getByRole('button', { name: 'Copied' })).toBeVisible();
    await bulkActions.getByRole('button', { name: 'Clear' }).click();

    await page.getByRole('button', { name: 'More view controls' }).click();
    await page.getByRole('menuitem', { name: 'Layout' }).click();
    const layout = route === 'initiatives' ? 'Timeline' : 'Board';
    await page
      .getByRole('dialog', { name: 'Layout view' })
      .getByRole('radio', { name: layout })
      .click();
    if (layout === 'Board') {
      const board = page.getByRole('region', { name: `${title.slice(0, -1)} board` });
      await expect(board).toBeVisible();
      const card = board.getByRole('article', { name: row });
      const cell = card.locator('xpath=ancestor::section[@data-testid][1]');
      const reordered = page.waitForResponse(
        (response) =>
          response.url().endsWith('/work-views/order') &&
          response.request().method() === 'PATCH' &&
          response.ok(),
      );
      await card.dragTo(cell);
      await reordered;
    } else {
      await expect(page.getByRole('grid', { name: 'Initiatives timeline' })).toBeVisible();
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloadedTab = page.getByRole('tab', { name: viewName });
    await expect(reloadedTab).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Remove ${viewName} from favorites` }),
    ).toHaveAttribute('aria-pressed', 'true');
    await reloadedTab.click();
    await openOverflowControl(page, 'Reset to default');
    await expect(page.getByRole('checkbox', { name: `Select ${row}` })).toBeVisible();
  }
});
