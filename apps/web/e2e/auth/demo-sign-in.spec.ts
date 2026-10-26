/** Reviewer accounts are created by scripts/seed-demo.ts before starting the local dev stack. */
import { readFileSync } from 'node:fs';

import { myWorkHref } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

test('reviewer opens a supplied magic link and owns the four sample tasks', async ({
  page,
  context,
}) => {
  const file = process.env['DEMO_REVIEW_LINK_FILE'];
  if (!file) throw new Error('DEMO_REVIEW_LINK_FILE must identify the private seeded link file.');
  const supplied = new URL(readFileSync(file, 'utf8').trim());
  const entry = `${supplied.pathname}${supplied.search}${supplied.hash}`;
  const otherFile = process.env['DEMO_OTHER_LINK_FILE'];
  if (!otherFile)
    throw new Error('DEMO_OTHER_LINK_FILE must identify a second seeded account link.');
  const other = new URL(readFileSync(otherFile, 'utf8').trim());
  await page.goto(`${other.pathname}${other.search}${other.hash}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForURL('**/today');
  const otherSession = await apiJson<{ user: { email: string } }>(page, '/api/auth/get-session');
  expect(otherSession.user.email).toBe('other-review@example.com');
  for (let visit = 0; visit < 3; visit++) {
    // Exercise another existing account, a fresh browser, then an already-signed-in reviewer.
    if (visit === 1) await context.clearCookies();
    await page.goto(entry, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/today');
    expect(new URL(page.url()).hash).toBe('');
    const session = await apiJson<{ user: { email: string } }>(page, '/api/auth/get-session');
    expect(session.user.email).toBe('mcp-review@theaicompany.org');
  }
  const organizations = await apiJson<{ items: { id: string; slug: string }[] }>(page, '/v1/orgs');
  const workspace = organizations.items.find((org) => org.slug === 'openai-review');
  expect(workspace).toBeTruthy();
  const tasks = await apiJson<{ items: { title: string }[] }>(
    page,
    `/v1/orgs/${workspace?.id}/tasks`,
  );
  expect(tasks.items.map((task) => task.title).sort()).toEqual(
    [
      'Invite a teammate to a project',
      'Plan the next launch milestone',
      'Review the onboarding checklist',
      'Set a due date on a task',
    ].sort(),
  );
  await expect(page.getByRole('heading', { name: /today/i }).first()).toBeVisible();
  if (!workspace) throw new Error('Reviewer workspace was not available after sign-in.');
  await page.goto(myWorkHref(workspace.id), { waitUntil: 'domcontentloaded' });
  for (const task of tasks.items) {
    await expect(page.getByText(task.title, { exact: true }).first()).toBeVisible();
  }
});
