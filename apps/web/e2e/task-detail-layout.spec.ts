/**
 * The task page's layout rules (`docs/design/references/detail-page-layout.md`), measured.
 *
 * @remarks
 * Rule 1: two columns on a wide pane, one on a narrow one. Rule 2: every body section ends on one
 * right edge. Rule 3: each property is on screen once. Rule 8: no sideways scroll from 320px up.
 */
import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from './helpers/app';
import { orgHref, TIMEOUTS } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { apiJson } from './helpers/net';

async function openSeededTask(page: Page): Promise<void> {
  const { orgId } = await signUpAndOnboard(page, 'TaskLayout');
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('Onboarding produced no team');
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: {
      title: 'Build the social story graphic generator',
      teamId,
      description:
        '## Problem\n\nSharing takes effort.\n\n## Proposed change\n\nA canvas renderer.',
    },
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${task.id}/subtasks`, {
    method: 'POST',
    body: { title: 'Render a 1080×1920 image' },
  });
  await page.goto(`${orgHref(orgId, 'tasks')}/${task.id}`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('region', { name: /Subtasks/ })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
}

async function rightEdge(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('A body section must have measurable bounds');
  return Math.round(box.x + box.width);
}

async function overflowsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

test('a wide pane shows every property once in the sidebar, beside one aligned column', async ({
  page,
}) => {
  // Wide enough to dock the sidebar with the calendar rail open, as on a 1920px display.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openSeededTask(page);

  const sidebar = page.getByRole('complementary', { name: 'Details' });
  await expect(sidebar).toBeVisible();
  for (const name of [/^Status —/, /^Priority —/, /^Assignee —/, /^Parent —/, /^Due —/]) {
    await expect(sidebar.getByRole('button', { name })).toHaveCount(1);
    await expect(page.getByRole('button', { name })).toHaveCount(1);
  }
  await expect(page.getByRole('group', { name: 'Task properties' })).toHaveCount(0);
  // One sidebar, so no contents list beside the description.
  await expect(page.getByRole('navigation', { name: /contents/i })).toHaveCount(0);

  const edges = await Promise.all(
    [
      page.locator('.entity-document').first(),
      page.getByRole('region', { name: /Subtasks/ }),
      page.getByRole('region', { name: /Relations/ }),
      page.getByRole('region', { name: /Activity/ }),
    ].map(rightEdge),
  );
  expect(new Set(edges).size).toBe(1);
  expect(await overflowsSideways(page)).toBe(false);
});

test('the relationship controls work from the keyboard alone', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openSeededTask(page);

  // Add a subtask: the composer takes focus, Enter adds and stays open, Escape closes.
  await page.getByRole('button', { name: 'Add subtask' }).focus();
  await page.keyboard.press('Enter');
  const composer = page.getByRole('textbox', { name: 'New subtask title' });
  await expect(composer).toBeFocused();
  await page.keyboard.type('Pick the share icon');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Pick the share icon' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(composer).toHaveCount(0);

  // A row is one link, and its controls follow it in tab order, the remove button shown on focus.
  const row = page.getByRole('link', { name: 'Render a 1080×1920 image' });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const remove = page.getByRole('button', {
    name: 'Remove from subtasks: Render a 1080×1920 image',
  });
  await expect(remove).toBeFocused();
  await expect(remove).toHaveCSS('opacity', '1');

  // The Relations menu opens from the keyboard, and a choice hands focus to its search.
  await page.getByRole('button', { name: 'Add relation' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Add blocker' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByPlaceholder('Find the task this one waits on…')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Task that blocks this one' })).toHaveCount(0);
});

test('a narrow pane carries every property as header chips and never scrolls sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSeededTask(page);

  await expect(page.getByRole('complementary', { name: 'Details' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Task properties' })).toBeVisible();
  expect(await overflowsSideways(page)).toBe(false);

  await page.setViewportSize({ width: 320, height: 844 });
  expect(await overflowsSideways(page)).toBe(false);
});
