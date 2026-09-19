/**
 * Visual evidence for the task detail page.
 *
 * @remarks
 * A populated task, not an empty one: three subtasks, a blocker and a blocked task, two labels, an
 * estimate, a project, a due date, comments, and a resource link. Every tab is shot at desktop and
 * phone widths in both colour schemes, the wide frame that docks the properties beside the body is
 * shot at 1900px, and a 320px frame proves the page never scrolls the document sideways.
 *
 * Evidence capture, so it runs only under `pnpm test:e2e:evidence`. Set `TASK_DETAIL_SHOT_DIR` to
 * write the images somewhere other than the audit folder.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { expectNoDocumentOverflow } from '../helpers/roster';
import { setColorScheme } from '../helpers/ui';

const SHOT_DIR =
  process.env['TASK_DETAIL_SHOT_DIR'] ??
  resolve(import.meta.dirname, '../../../../docs/design/audits/screenshots/2026-09-18-task-detail');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1900, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const TABS = ['overview', 'resources', 'graph'] as const;

interface Created {
  readonly id: string;
}

/** Create the populated task the shots and the overflow check open. */
async function seedTask(page: Page, orgId: string): Promise<string> {
  const teams = await apiJson<{ items: readonly Created[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('Onboarding did not create a team.');
  const post = <T>(path: string, body: unknown): Promise<T> =>
    apiJson<T>(page, `/v1/orgs/${orgId}${path}`, { method: 'POST', body });

  const project = await post<Created>('/projects', { name: 'Atlas Launch', teamId });
  const other = await post<Created>('/projects', { name: 'Docs Refresh', teamId });
  const bug = await post<Created>('/labels', { name: 'bug' });
  const infra = await post<Created>('/labels', { name: 'infra' });
  const task = await post<Created>('/tasks', {
    title: 'Ship the roster view for the Atlas dashboard',
    description:
      '## Goal\n\nShip the roster view so a manager can see every active project, its health, and who owns it.\n\n- Owners are shown with avatars\n- Health uses the workspace scale',
    teamId,
    priority: 'high',
    projectId: project.id,
    dueDate: '2026-10-09',
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${task.id}`, {
    method: 'PATCH',
    body: { estimate: 5, labels: [bug.id, infra.id] },
  });
  for (const title of ['Draft the row layout', 'Wire owner avatars', 'Cover empty projects']) {
    await post(`/tasks/${task.id}/subtasks`, { title });
  }
  const blocker = await post<Created>('/tasks', {
    title: 'Finalize the health scale',
    teamId,
    projectId: other.id,
  });
  const blocked = await post<Created>('/tasks', {
    title: 'Announce the dashboard to customers',
    teamId,
    projectId: project.id,
  });
  await post(`/tasks/${task.id}/dependencies`, { blockingTaskId: blocker.id });
  await post(`/tasks/${task.id}/dependencies`, { blockedTaskId: blocked.id });
  for (const body of [
    'Started on the row layout today.',
    'The health scale is blocked on design.',
  ]) {
    await post('/comments', { subjectType: 'task', subjectId: task.id, body });
  }
  await post(`/tasks/${task.id}/attachments`, {
    kind: 'url',
    title: 'Design notes',
    url: 'https://example.com/design-notes',
  });
  return task.id;
}

test('the task page reads like an issue at every width, tab, and scheme', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const { orgId } = await signUpAndOnboard(page, 'TaskDetailShots');
  const taskId = await seedTask(page, orgId);
  const route = `/orgs/${orgId}/tasks/${taskId}`;

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const tab of TABS) {
      await page.goto(tab === 'overview' ? route : `${route}?tab=${tab}`, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.pageReady,
      });
      await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toBeVisible({
        timeout: TIMEOUTS.pageReady,
      });
      if (tab === 'graph') await expect(page.locator('.react-flow__node').first()).toBeVisible();
      for (const scheme of ['light', 'dark'] as const) {
        await setColorScheme(page, scheme);
        await page.waitForTimeout(300);
        // Not `animations: 'disabled'`: the collapsing header is a paused CSS animation whose
        // progress is the scroll offset, and Playwright would fast-forward it to its collapsed end.
        await page.screenshot({
          path: resolve(SHOT_DIR, `task-${tab}-${viewport.name}-${scheme}.png`),
        });
      }
    }
  }
});

test('the task page never scrolls the document sideways at 320px', async ({ page }) => {
  test.setTimeout(300_000);
  const { orgId } = await signUpAndOnboard(page, 'TaskDetailOverflow');
  const taskId = await seedTask(page, orgId);
  await page.setViewportSize({ width: 320, height: 844 });

  for (const tab of TABS) {
    await page.goto(
      `${orgHref(orgId, 'tasks')}/${taskId}${tab === 'overview' ? '' : `?tab=${tab}`}`,
      {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.pageReady,
      },
    );
    await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await expectNoDocumentOverflow(page);
  }
});
