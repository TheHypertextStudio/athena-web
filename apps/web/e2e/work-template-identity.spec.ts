import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { signUpAndOnboard } from './helpers/app';
import { TIMEOUTS } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { apiJson, waitForApiResponse } from './helpers/net';
import { blueprintWorkspace } from './helpers/work-template-blueprints';
import { renderedContrastRatio } from './helpers/calendar-ui';

const sessionPath = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (sessionPath) test.use({ storageState: sessionPath });

async function workspace(page: Page): Promise<string> {
  page.setDefaultTimeout(TIMEOUTS.ui);
  if (!sessionPath) return (await signUpAndOnboard(page, 'TemplateIdentity')).orgId;
  return (await blueprintWorkspace(page)).orgId;
}

async function createDraft(
  page: Page,
  orgId: string,
  kind: string,
  name: string,
): Promise<WorkTemplateOut> {
  await page.goto(`/orgs/${orgId}/settings/templates/new`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('combobox', { name: 'Kind of work', exact: true }).selectOption(kind);
  await page.getByRole('textbox', { name: 'Template name', exact: true }).fill(name);
  await page
    .getByRole('textbox', { name: 'When to use it', exact: true })
    .fill('A community event with a clear preparation plan.');
  await page.getByRole('button', { name: 'Define the work', exact: true }).click();
  await page
    .getByRole('textbox', {
      name: kind === 'task' ? 'Starting title' : 'Starting name',
      exact: true,
    })
    .fill('Community dinner');
  await page
    .getByRole('textbox', { name: 'Starting document', exact: true })
    .fill('Confirm the venue and welcome the neighbors.');
  const response = waitForApiResponse(page, /\/templates\/definitions$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect((await response).ok()).toBe(true);
  const draft = (await (await response).json()) as WorkTemplateOut;
  await expect(page).toHaveURL(new RegExp(`/templates/${draft.id}$`));
  await expect(page.getByRole('tab', { name: 'Work', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  return draft;
}

async function publish(page: Page): Promise<WorkTemplateOut> {
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  const response = waitForApiResponse(page, /\/templates\/definitions\/[^/]+\/publish$/, {
    method: 'POST',
  });
  await page.getByRole('button', { name: /Publish (to workspace|next version)/ }).click();
  expect((await response).ok()).toBe(true);
  return (await (await response).json()) as WorkTemplateOut;
}

for (const kind of ['initiative', 'program', 'project', 'task']) {
  test(`${kind} drafts reopen privately and publish immutable starting fields`, async ({
    page,
  }) => {
    const orgId = await workspace(page);
    const name = `${kind} identity ${Date.now()}`;
    const draft = await createDraft(page, orgId, kind, name);
    expect(draft.scope).toBe('personal');
    expect(draft.latestVersion).toBeNull();
    await page.reload({ waitUntil: 'commit' });
    await expect(
      page.getByRole('textbox', {
        name: kind === 'task' ? 'Starting title' : 'Starting name',
        exact: true,
      }),
    ).toHaveValue('Community dinner');
    await expect(
      page.getByRole('textbox', { name: 'Starting document', exact: true }),
    ).toContainText('Confirm the venue');
    const published = await publish(page);
    expect(published.scope).toBe('organization');
    expect(published.latestVersion?.number).toBe(1);
    await page.getByRole('button', { name: 'Published history', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Version 1', exact: true })).toBeVisible();
  });
}

test.describe('canonical template editor accessibility and recovery', () => {
  test.use({ hasTouch: true });
  test('keyboard editing and failed saves retain a recoverable draft on a short phone', async ({
    page,
  }) => {
    const orgId = await workspace(page);
    const draft = await createDraft(page, orgId, 'project', `Recoverable event ${Date.now()}`);
    await page.setViewportSize({ width: 320, height: 600 });
    await page.getByRole('tab', { name: 'Purpose', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Template name', exact: true });
    await name.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: 'When to use it', exact: true })).toBeFocused();
    await name.fill('Retained after a failed save');
    const save = page.getByRole('button', { name: 'Save draft', exact: true });
    await save.scrollIntoViewIfNeeded();
    const bounds = await save.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(40);
    expect(bounds?.width).toBeGreaterThanOrEqual(40);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await expect.poll(() => renderedContrastRatio(save)).toBeGreaterThanOrEqual(4.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    const draftRoute = `**/templates/definitions/${draft.id}/draft`;
    await page.route(
      draftRoute,
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Provider internals must stay hidden',
            status: 503,
          }),
        }),
      { times: 1 },
    );
    await save.click();
    await expect(page.getByText('Template could not be saved', { exact: true })).toBeVisible();
    await expect(name).toHaveValue('Retained after a failed save');
    const captureOut = process.env['E2E_WORK_TEMPLATE_REVIEW_OUT'];
    if (captureOut) {
      mkdirSync(captureOut, { recursive: true });
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(save).toBeInViewport();
        await expect
          .poll(() => renderedContrastRatio(page.getByRole('heading', { level: 1 })))
          .toBeGreaterThanOrEqual(4.5);
        await page.screenshot({
          path: `${captureOut}/failed-save-320x600-${colorScheme}.png`,
          fullPage: false,
          animations: 'disabled',
        });
      }
    }
    await expect(
      page.getByText('Provider internals must stay hidden', { exact: true }),
    ).toHaveCount(0);
    const saved = waitForApiResponse(page, /\/draft$/, { method: 'PATCH' });
    await save.click();
    expect((await saved).ok()).toBe(true);
    await page.reload({ waitUntil: 'commit' });
    await page.getByRole('tab', { name: 'Purpose', exact: true }).click();
    await expect(name).toHaveValue('Retained after a failed save');
  });
});

test('Event project retains its publication, then changes identity without replacing work', async ({
  page,
}) => {
  const orgId = await workspace(page);
  const name = `Event ${Date.now()}`;
  const draft = await createDraft(page, orgId, 'project', name);
  const versionOne = await publish(page);
  await page.goto(`/orgs/${orgId}/projects`, { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'New project', exact: true });
  await composer.getByRole('button', { name: /^Blank project$/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
  await page.getByRole('button', { name: 'Apply starting fields', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue(
    'Community dinner',
  );
  await composer
    .getByRole('textbox', { name: 'Project name', exact: true })
    .fill('Neighborhood dinner');
  const created = waitForApiResponse(page, /\/projects$/, { method: 'POST' });
  await composer.getByRole('button', { name: 'Create Project', exact: true }).click();
  expect((await created).ok()).toBe(true);
  const project = (await (await created).json()) as {
    id: string;
    workTypeId: string;
    workTypeVersionId: string;
    description: string;
  };
  expect(project.workTypeId).toBe(draft.id);
  expect(project.workTypeVersionId).toBe(versionOne.latestVersion?.id);
  await page.goto(`/orgs/${orgId}/projects/${project.id}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(
    page.getByRole('button', { name: `Change template: ${name}, Version 1`, exact: true }),
  ).toBeVisible();
  await page.goto(`/orgs/${orgId}/settings/templates/${draft.id}`, { waitUntil: 'commit' });
  await page
    .getByRole('textbox', { name: 'Starting document', exact: true })
    .fill('A revised starting document for future dinners.');
  const saved = waitForApiResponse(page, /\/draft$/, { method: 'PATCH' });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  const versionTwo = await publish(page);
  await page.goto(`/orgs/${orgId}/projects/${project.id}`, { waitUntil: 'commit' });
  await page
    .getByRole('button', { name: `Change template: ${name}, Version 1`, exact: true })
    .click();
  await page.getByRole('menuitem', { name: `${name} · Version 2`, exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Update template', exact: true });
  await expect(preview).toContainText(
    'Your outline stays unchanged. Choose each work change to adopt.',
  );
  const changed = waitForApiResponse(page, /\/template\/update$/, { method: 'POST' });
  await preview.getByRole('button', { name: 'Update template', exact: true }).click();
  expect((await changed).ok()).toBe(true);
  const reopened = await apiJson<{ workTypeVersionId: string; description: string }>(
    page,
    `/v1/orgs/${orgId}/projects/${project.id}`,
  );
  expect(reopened.workTypeVersionId).toBe(versionTwo.latestVersion?.id);
  expect(reopened.description).toBe(project.description);
  await expect(
    page.getByRole('button', { name: `Change template: ${name}, Version 2`, exact: true }),
  ).toBeVisible();
  await page.goto(`/orgs/${orgId}/projects`, { waitUntil: 'commit' });
  const display = page.getByRole('dialog', { name: 'Display view', exact: true });
  const grouping = display.getByRole('combobox', { name: 'Group by', exact: true });
  await expect(async () => {
    if (!(await display.isVisible()))
      await page.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(display).toBeVisible({ timeout: 1000 });
    if (!(await grouping.isVisible()))
      await display.getByRole('button', { name: 'Organize', exact: true }).click();
    await expect(grouping).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: TIMEOUTS.pageReady });
  await grouping.selectOption('workTypeId');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Display', exact: true }).click();
  await display.getByRole('button', { name: 'Find in this view', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Search Projects', exact: true })
    .fill('Neighborhood dinner');
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Neighborhood dinner', { exact: true }).first()).toBeVisible();
  const evidencePath = process.env['E2E_WORK_TEMPLATE_EVIDENCE'];
  if (evidencePath)
    writeFileSync(
      evidencePath,
      JSON.stringify({ orgId, projectId: project.id, templateId: draft.id, name }),
    );
});
