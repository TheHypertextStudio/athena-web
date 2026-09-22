/**
 * End-to-end proof that a task's relationships can be edited from the task page itself: blockers,
 * blocked tasks, related tasks, new and existing subtasks, detaching a subtask, and the parent.
 */
import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { signUpAndOnboard } from './helpers/app';
import { orgHref, TIMEOUTS } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { apiJson } from './helpers/net';

interface TaskRefRecord {
  readonly id: string;
  readonly title: string;
}

interface TaskDetailRecord {
  readonly parentTaskId: string | null;
  readonly blocking: readonly TaskRefRecord[];
  readonly blockedBy: readonly TaskRefRecord[];
  readonly relatedTasks: readonly TaskRefRecord[];
  readonly subtasks: readonly TaskRefRecord[];
}

async function createTask(page: Page, orgId: string, teamId: string, title: string) {
  return (
    await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title, teamId },
    })
  ).id;
}

/** Poll the task's detail until `read` of it matches `expected`. */
async function expectDetail<T>(
  page: Page,
  orgId: string,
  taskId: string,
  read: (detail: TaskDetailRecord) => T,
  expected: T,
): Promise<void> {
  await expect
    .poll(
      async () => read(await apiJson<TaskDetailRecord>(page, `/v1/orgs/${orgId}/tasks/${taskId}`)),
      {
        timeout: TIMEOUTS.pageReady,
      },
    )
    .toEqual(expected);
}

const titles = (list: readonly TaskRefRecord[]): string[] => list.map((task) => task.title).sort();

/**
 * Pick `title` from the open task search named `list`.
 *
 * @remarks
 * Scoped to the list by name: a search that just closed can still be animating out, and it holds
 * the same tasks.
 */
async function pick(page: Page, list: string, title: string): Promise<void> {
  const option = page.getByRole('listbox', { name: list }).getByRole('option', { name: title });
  await expect(option).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await option.getByRole('button').click();
}

/** Open the Relations `+` menu, choose `item`, and pick `title` from the search it opens. */
async function addRelation(page: Page, item: string, list: string, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Add relation' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await pick(page, list, title);
}

test('a task page adds and removes every kind of relationship in place', async ({ page }) => {
  // Wide enough to dock the properties sidebar, where the parent picker is a row.
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { orgId } = await signUpAndOnboard(page, 'TaskRelations');
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('Onboarding produced no team');

  const mainId = await createTask(page, orgId, teamId, 'Plan the launch event');
  const others = [
    'Confirm the venue',
    'Send the invitations',
    'Launch budget sheet',
    'Order name badges',
    'Quarterly events',
  ];
  for (const title of others) {
    await createTask(page, orgId, teamId, title);
  }
  // The search index trails a write; the pickers read it, so wait until every task is findable.
  await expect
    .poll(
      async () => {
        const found = await apiJson<{ items: { title: string }[] }>(
          page,
          `/v1/orgs/${orgId}/search?kinds=task&limit=20`,
        );
        const indexed = new Set(found.items.map((item) => item.title));
        return others.every((title) => indexed.has(title));
      },
      { timeout: TIMEOUTS.pageReady },
    )
    .toBe(true);

  await page.goto(`${orgHref(orgId, 'tasks')}/${mainId}`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('button', { name: 'Add relation' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  await addRelation(page, 'Add blocker', 'Task that blocks this one', 'Confirm the venue');
  await expectDetail(page, orgId, mainId, (d) => titles(d.blockedBy), ['Confirm the venue']);

  await addRelation(page, 'Add blocked task', 'Task this one blocks', 'Send the invitations');
  await expectDetail(page, orgId, mainId, (d) => titles(d.blocking), ['Send the invitations']);

  await addRelation(page, 'Add related task', 'Related task', 'Launch budget sheet');
  await expectDetail(page, orgId, mainId, (d) => titles(d.relatedTasks), ['Launch budget sheet']);

  await page.getByRole('button', { name: 'Remove blocker: Confirm the venue' }).click();
  await expectDetail(page, orgId, mainId, (d) => titles(d.blockedBy), []);

  await page.getByRole('button', { name: 'Add subtask' }).click();
  const composer = page.getByRole('textbox', { name: 'New subtask title' });
  await composer.fill('Book the caterer');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expectDetail(page, orgId, mainId, (d) => titles(d.subtasks), ['Book the caterer']);
  await composer.press('Escape');

  await page.getByRole('button', { name: 'Add existing task' }).click();
  await pick(page, 'Existing task to add as a subtask', 'Order name badges');
  await expectDetail(page, orgId, mainId, (d) => titles(d.subtasks), [
    'Book the caterer',
    'Order name badges',
  ]);

  await page.getByRole('button', { name: 'Remove from subtasks: Order name badges' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expectDetail(page, orgId, mainId, (d) => titles(d.subtasks), ['Book the caterer']);

  await page.getByRole('button', { name: /^Parent —/ }).click();
  await pick(page, 'Parent task', 'Quarterly events');
  await expectDetail(page, orgId, mainId, (d) => d.parentTaskId !== null, true);
  // The page keeps working after its own task moves: the breadcrumb names the new parent.
  await expect(
    page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Quarterly events' }),
  ).toBeVisible();

  await captureEvidence(page);
});

/** Save the populated page in both themes when `CAPTURE_TASK_DETAIL_EVIDENCE=1`. */
async function captureEvidence(page: Page): Promise<void> {
  if (process.env['CAPTURE_TASK_DETAIL_EVIDENCE'] !== '1') return;
  await page.mouse.move(4, 4);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    // Colour tokens transition on a theme change; let them land before the capture.
    await page.waitForTimeout(600);
    await page.screenshot({
      path: fileURLToPath(
        new URL(
          `../../../docs/design/audits/evidence/2026-09-22-task-detail-1920-${colorScheme}.png`,
          import.meta.url,
        ),
      ),
    });
  }
}
