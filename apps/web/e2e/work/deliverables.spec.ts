import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Locator, Page, Response, TestInfo } from '@playwright/test';
import axe, { type AxeStatic } from 'axe-core';
import { expect, test } from '../helpers/fixtures';
import { signUpAndOnboard } from '../helpers/app';
import { openPlan } from '../helpers/daily-planning';
import { apiJson } from '../helpers/net';
import { attachShot } from '../helpers/ui';
import { waitForCaptureAnimations } from '../tools/capture-animations';

const sessionPath = process.env['E2E_SESSION'];
if (sessionPath) test.use({ storageState: sessionPath });

test('people attach deliverables to an update and a task comment, retain a failed draft, and download the saved work', async ({
  page,
}) => {
  const { orgId } = sessionPath
    ? (JSON.parse(readFileSync(`${sessionPath}.meta.json`, 'utf8')) as { orgId: string })
    : await signUpAndOnboard(page, 'Deliverables');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await apiJson(page, '/v1/hub/preferences', { method: 'PATCH', body: { timezone: 'UTC' } });
  await openPlan(page, new Date().toISOString().slice(0, 10));
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name: 'Station access review', summary: 'Share the completed access review.' },
  });
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { teamId: teams.items[0]?.id, projectId: project.id, title: 'Publish the access review' },
  });
  for (const surface of [
    {
      kind: 'update',
      endpoint: 'updates',
      editor: 'Post an update',
      submit: 'Post update',
      path: `projects/${project.id}?tab=updates`,
    },
    {
      kind: 'comment',
      endpoint: 'comments',
      editor: 'Add a comment',
      submit: 'Comment',
      path: `tasks/${task.id}`,
    },
  ]) {
    await page.goto(`/orgs/${orgId}/${surface.path}`, { waitUntil: 'domcontentloaded' });
    const editor = page.getByRole('textbox', {
      name: surface.editor,
      exact: true,
    });
    await expect(editor).toBeVisible({ timeout: 40_000 });
    await editor.fill('The completed review is attached.');
    const name = `${surface.kind}-access-review.txt`;
    const contents = `Completed ${surface.kind} deliverable`;
    await page
      .getByLabel('Choose files to attach', { exact: true })
      .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(contents) });
    await expect(page.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible();
    const endpoint = `**/v1/orgs/${orgId}/${surface.endpoint}`;
    await page.route(
      endpoint,
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ type: 'about:blank', title: 'Unavailable', status: 503 }),
          });
        } else await route.continue();
      },
      { times: 1 },
    );
    const isPost = (response: Response): boolean =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/v1/orgs/${orgId}/${surface.endpoint}`;
    const [failedPost] = await Promise.all([
      page.waitForResponse(isPost),
      page.getByRole('button', { name: surface.submit, exact: true }).click(),
    ]);
    expect(failedPost.status()).toBe(503);
    await expect(editor).toContainText('The completed review is attached.');
    await expect(page.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible();
    const [savedPost] = await Promise.all([
      page.waitForResponse(isPost),
      page.getByRole('button', { name: surface.submit, exact: true }).click(),
    ]);
    expect(savedPost.status(), await savedPost.text()).toBe(201);
    const saved = (await savedPost.json()) as { authorId: string };
    expect(saved).toMatchObject({ attachments: [{ fileName: name }] });
    const link = page.getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    await expect(editor).toBeEmpty();
    const downloaded = await page.request.get((await link.getAttribute('href')) ?? '');
    expect(downloaded.status()).toBe(200);
    expect(await downloaded.text()).toBe(contents);
    if (surface.kind === 'update') {
      const feed = await apiJson<{ authors: { actorId: string; displayName: string }[] }>(
        page,
        `/v1/orgs/${orgId}/updates?subjectType=project&subjectId=${project.id}`,
      );
      const author = feed.authors.find((candidate) => candidate.actorId === saved.authorId);
      if (!author) throw new Error('The saved update must have a named author.');
      await expect(
        page
          .locator('ol > li')
          .filter({ has: link })
          .getByText(author.displayName, { exact: true }),
      ).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }

  await page.goto(`/orgs/${orgId}/tasks/${task.id}`, { waitUntil: 'domcontentloaded' });
  const imageComment = page.getByRole('textbox', { name: 'Add a comment', exact: true });
  await expect(imageComment).toBeVisible({ timeout: 40_000 });
  await imageComment.fill('The task walkthrough image is attached.');
  const imageName = 'task-detail.jpg';
  await page
    .getByLabel('Choose files to attach', { exact: true })
    .setInputFiles(resolve(process.cwd(), 'public/marketing/task-detail.jpg'));
  await expect(page.getByRole('img', { name: imageName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByRole('link', { name: imageName, exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: imageName, exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole('img', { name: imageName, exact: true })
        .evaluate((element) => (element instanceof HTMLImageElement ? element.naturalWidth : 0)),
    )
    .toBeGreaterThan(0);
  if (sessionPath) await page.context().storageState({ path: sessionPath });
});

test('keyboard upload controls preserve other files through failure, cancellation and retry', async ({
  page,
}, testInfo) => {
  const { orgId } = sessionPath
    ? (JSON.parse(readFileSync(`${sessionPath}.meta.json`, 'utf8')) as { orgId: string })
    : await signUpAndOnboard(page, 'Upload recovery');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await apiJson(page, '/v1/hub/preferences', { method: 'PATCH', body: { timezone: 'UTC' } });
  await openPlan(page, new Date().toISOString().slice(0, 10));
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name: 'Upload recovery review' },
  });
  await page.setViewportSize({ width: 320, height: 844 });
  const device = await page.context().newCDPSession(page);
  await device.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await page.goto(`/orgs/${orgId}/projects/${project.id}?tab=updates`, {
    waitUntil: 'domcontentloaded',
  });
  const editor = page.getByRole('textbox', { name: 'Post an update', exact: true });
  await expect(editor).toBeVisible({ timeout: 40_000 });
  await editor.fill('The recovered files are attached.');
  const submit = page.getByRole('button', { name: 'Post update', exact: true });
  const attach = page.getByRole('button', { name: 'Attach files', exact: true });
  await expect(submit).toBeEnabled();
  const [attachBounds, submitBounds] = await Promise.all([
    attach.boundingBox(),
    submit.boundingBox(),
  ]);
  expect(Math.abs((attachBounds?.y ?? -1) - (submitBounds?.y ?? -100))).toBeLessThanOrEqual(1);
  await submit.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(attach).toBeFocused();
  await captureUploadState(page, testInfo, 'keyboard-picker-focus', attach);
  await expect(attach).toBeFocused();
  const endpoint = `**/v1/orgs/${orgId}/deliverables`;
  await page.route(endpoint, (route) => route.fulfill({ status: 503, body: '' }), { times: 1 });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const name = 'access-review-with-a-long-deliverable-name-for-retry.txt';
  await (
    await chooser
  ).setFiles([
    { name, mimeType: 'text/plain', buffer: Buffer.from('Recovered work') },
    {
      name: 'task-detail.jpg',
      mimeType: 'image/jpeg',
      buffer: readFileSync(resolve(process.cwd(), 'public/marketing/task-detail.jpg')),
    },
  ]);
  const retry = page.getByRole('button', { name: `Retry upload of ${name}`, exact: true });
  const otherFile = page.getByRole('button', { name: 'Remove task-detail.jpg', exact: true });
  await expect(retry).toBeVisible();
  await expect(otherFile).toBeVisible();
  const pending = page.getByLabel('Uploads in progress', { exact: true });
  await captureUploadState(page, testInfo, 'upload-failed', pending);
  let release!: () => void;
  const held = new Promise<void>((resolveHeld) => {
    release = resolveHeld;
  });
  await page.route(
    endpoint,
    async (route) => {
      await held;
      await route.abort().catch(() => undefined);
    },
    { times: 1 },
  );
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('progressbar', { name: `Uploading ${name}` })).toBeVisible();
  await expect(submit).toBeDisabled();
  await captureUploadState(page, testInfo, 'upload-progress', pending);
  await page.getByRole('button', { name: `Cancel upload of ${name}`, exact: true }).click();
  release();
  await expect(
    page.getByText('Upload cancelled. Retry or remove this file.', { exact: true }),
  ).toBeVisible();
  await captureUploadState(page, testInfo, 'upload-cancelled', pending);
  await page.unroute(endpoint);
  await retry.click();
  await expect(page.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible();
  await expect(otherFile).toBeVisible();
  await submit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'task-detail.jpg', exact: true })).toBeVisible();
  for (const fileName of [name, 'task-detail.jpg']) {
    const bounds = await page.getByRole('link', { name: fileName, exact: true }).boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(40);
    expect(bounds?.width).toBeGreaterThanOrEqual(40);
  }
});

/** Capture the real upload state and check the shared composer in each theme. */
async function captureUploadState(
  page: Page,
  testInfo: TestInfo,
  name: string,
  target: Locator,
): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await target.scrollIntoViewIfNeeded();
    await waitForCaptureAnimations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    const violations = await page.evaluate(
      async () =>
        (
          await (window as unknown as { axe: AxeStatic }).axe.run('form', {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
          })
        ).violations,
    );
    expect(violations).toEqual([]);
    const undersized = await page.locator('form button:visible').evaluateAll((buttons) =>
      buttons
        .filter((button) => {
          const bounds = button.getBoundingClientRect();
          return bounds.height < 40 || bounds.width < 40;
        })
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    );
    expect(undersized).toEqual([]);
    await attachShot(testInfo, page, `${name}-${colorScheme}`);
  }
}
