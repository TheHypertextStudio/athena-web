import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { RecurrenceSeriesDetailOut } from '../src/lib/contracts/recurrence';

import { signUpAndOnboard } from './helpers/app';
import { TIMEOUTS } from './helpers/constants';
import { renderedContrastRatio } from './helpers/calendar-ui';
import { expect, test } from './helpers/fixtures';
import { createMobileAuditFixture, type MobileAuditFixture } from './helpers/mobile-audit-fixture';
import { apiJson, waitForApiResponse } from './helpers/net';

const sessionPath = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (sessionPath) test.use({ storageState: sessionPath });

/** Reuse an explicit local audit session, or create an isolated account through the normal ceremony. */
async function workspace(
  page: Page,
): Promise<{ orgId: string; fixture?: MobileAuditFixture | undefined }> {
  if (sessionPath) {
    const metadata = JSON.parse(readFileSync(`${sessionPath}.meta.json`, 'utf8')) as {
      orgId: string;
      mobileAuditFixture?: MobileAuditFixture;
    };
    if (!metadata.mobileAuditFixture) {
      await page.goto('/', { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
    }
    return {
      orgId: metadata.mobileAuditFixture?.orgId ?? metadata.orgId,
      fixture: metadata.mobileAuditFixture,
    };
  }
  const { orgId } = await signUpAndOnboard(page, 'WorkTemplates');
  return { orgId };
}

async function changeCadence(page: Page, cadence: string): Promise<void> {
  const inline = page.getByRole('combobox', { name: 'Repeat cadence' });
  if (await inline.isVisible()) {
    await inline.selectOption(cadence);
    return;
  }
  await page.getByRole('button', { name: /^Repeat —/ }).click();
  await inline.selectOption(cadence);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

for (const kind of ['Task', 'Project', 'Initiative', 'Program'] as const) {
  test(`${kind.toLowerCase()} templates persist work fields, edited metadata, and sharing after reopening`, async ({
    page,
  }) => {
    const { orgId } = await workspace(page);
    await page.goto(`/orgs/${orgId}/settings/templates`, {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    const suffix = Date.now();
    const name = `${kind} workflow ${suffix}`;
    await page.getByRole('button', { name: 'New template', exact: true }).click();
    await page.getByRole('menuitem', { name: kind, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `New ${kind.toLowerCase()} template` });
    await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Template name', exact: true }).fill(name);
    await dialog
      .getByRole('textbox', { name: 'When to use it', exact: true })
      .fill(`Reusable ${kind.toLowerCase()} starting fields.`);
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    const title = kind === 'Task' ? 'Task title (optional)' : `${kind} name (optional)`;
    await dialog.getByRole('textbox', { name: title, exact: true }).fill(`${kind} starting name`);
    await dialog
      .getByRole('textbox', { name: 'Work description', exact: true })
      .fill('Record the goal, owner, and next action.');
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();
    const saved = waitForApiResponse(page, /\/templates\/definitions$/, { method: 'POST' });
    await dialog.getByRole('button', { name: 'Create template', exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const draft = (await response.json()) as { id: string; scope: string; status: string };
    expect(draft.scope).toBe('personal');
    expect(draft.status).toBe('draft');
    await expect(page).toHaveURL(new RegExp(`/templates/${draft.id}$`));
    const starting = kind === 'Task' ? 'Starting title' : 'Starting name';
    await expect(page.getByRole('textbox', { name: starting, exact: true })).toHaveValue(
      `${kind} starting name`,
    );
    const renamed = `${name} revised`;
    await page.getByRole('textbox', { name: 'Template name', exact: true }).fill(renamed);
    await page.getByRole('textbox', { name: 'When to use it', exact: true }).fill('');
    const updated = waitForApiResponse(page, /\/draft$/, { method: 'PATCH' });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    expect((await updated).ok()).toBe(true);
    await page.reload({ waitUntil: 'commit' });
    await expect(page.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue(
      renamed,
    );
    await expect(page.getByRole('textbox', { name: 'When to use it', exact: true })).toHaveValue(
      '',
    );
    await expect(
      page.getByRole('textbox', { name: 'Starting document', exact: true }),
    ).toContainText('Record the goal, owner, and next action.');
    const publication = waitForApiResponse(page, /\/publish$/, { method: 'POST' });
    await page.getByRole('button', { name: 'Publish to workspace', exact: true }).click();
    expect((await publication).ok()).toBe(true);
    await expect(page.getByRole('button', { name: 'Version 1', exact: true })).toBeVisible();
  });
}

test('a project repeats through persisted setup and future revisions preserve occurrence history', async ({
  page,
}) => {
  const initial = await workspace(page);
  const fixture = initial.fixture ?? (await createMobileAuditFixture(page));
  const orgId = fixture.orgId;
  await page.goto(`/orgs/${orgId}/projects/${fixture.projectId}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Repeat project', exact: true }).click();
  const setup = page.getByRole('dialog').last();
  await expect(setup.getByRole('heading', { name: 'Work included', exact: true })).toBeVisible();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await changeCadence(page, 'daily');
  await page.setViewportSize({ width: 390, height: 600 });
  const options = setup.getByRole('button', { name: 'More options', exact: true });
  await options.scrollIntoViewIfNeeded();
  await options.click();
  const ahead = setup.getByRole('combobox', { name: 'Schedule ahead', exact: true });
  await ahead.scrollIntoViewIfNeeded();
  const aheadBounds = await ahead.boundingBox();
  const nextBounds = await setup
    .getByRole('button', { name: 'Continue', exact: true })
    .boundingBox();
  expect(aheadBounds).not.toBeNull();
  expect(nextBounds).not.toBeNull();
  if (!aheadBounds || !nextBounds)
    throw new Error('The advanced field and footer must be visible.');
  expect(aheadBounds.y + aheadBounds.height).toBeLessThanOrEqual(nextBounds.y);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  const saved = waitForApiResponse(page, /\/recurrence-series$/, { method: 'POST' });
  await setup.getByRole('button', { name: 'Start repeating', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const series = (await response.json()) as { id: string };
  await expect(page).toHaveURL(new RegExp(`/recurrence-series/${series.id}$`));
  await expect(page.getByRole('heading', { name: 'Upcoming', exact: true })).toBeVisible();
  const path = `/v1/orgs/${orgId}/recurrence-series/${series.id}`;
  await page
    .getByRole('button', { name: /^Change / })
    .first()
    .click();
  const skipped = waitForApiResponse(page, /\/edits$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Skip this occurrence', exact: true }).click();
  expect((await skipped).ok()).toBe(true);
  await expect(
    page
      .getByRole('region', { name: 'History', exact: true })
      .getByText('skipped', { exact: true }),
  ).toBeVisible();
  const before = await apiJson<RecurrenceSeriesDetailOut>(page, path);
  expect(before.trigger.kind).toBe('calendar');
  if (before.trigger.kind === 'calendar') expect(before.trigger.schedule.kind).toBe('daily');
  const paused = waitForApiResponse(page, /\/lifecycle$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect((await paused).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect((await apiJson<RecurrenceSeriesDetailOut>(page, path)).status).toBe('paused');
  const resumed = waitForApiResponse(page, /\/lifecycle$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  expect((await resumed).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await changeCadence(page, 'weekly');
  const revised = waitForApiResponse(page, /\/edits$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Save future schedule', exact: true }).click();
  expect((await revised).ok()).toBe(true);
  await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'commit' });
  const after = await apiJson<RecurrenceSeriesDetailOut>(page, path);
  expect(after.status).toBe('active');
  expect(after.revisions).toHaveLength(before.revisions.length + 1);
  expect(after.revisions[0]).toEqual(before.revisions[0]);
  const past = before.occurrences.filter((item) => item.status === 'skipped');
  expect(past.length).toBeGreaterThan(0);
  for (const occurrence of past) expect(after.occurrences).toContainEqual(occurrence);
});

test('generated work opens schedule management in place and restores focus after discarding a draft', async ({
  page,
}) => {
  const initial = await workspace(page);
  const fixture = initial.fixture ?? (await createMobileAuditFixture(page));
  await page.goto(`/orgs/${fixture.orgId}/tasks/${fixture.recurringTaskId}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  const opener = page.getByRole('button', { name: 'Manage repeating work', exact: true });
  await opener.click();
  const management = page.getByRole('dialog', { name: 'Manage repeating work', exact: true });
  await expect(management.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 600 });
  const lastChange = management
    .getByRole('region', { name: 'Upcoming', exact: true })
    .getByRole('button', { name: /^Change / })
    .last();
  await lastChange.scrollIntoViewIfNeeded();
  const lastBounds = await lastChange.boundingBox();
  const footerBounds = await management
    .getByRole('button', { name: 'Save future schedule', exact: true })
    .boundingBox();
  expect(lastBounds).not.toBeNull();
  expect(footerBounds).not.toBeNull();
  if (!lastBounds || !footerBounds)
    throw new Error('The final occurrence and footer must be visible.');
  expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(footerBounds.y);
  await page.setViewportSize({ width: 1440, height: 900 });
  await changeCadence(page, 'weekly');
  await management.getByRole('button', { name: 'Close repeating work', exact: true }).click();
  await expect(
    management.getByText('Discard your unsaved schedule changes?', { exact: true }),
  ).toBeVisible();
  await management.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(management.getByRole('button', { name: /^Repeat — Every week/ })).toBeVisible();
  await management.getByRole('button', { name: 'Close repeating work', exact: true }).click();
  await management.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(management).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(
    management.getByRole('button', { name: 'Repeat — Every day', exact: true }),
  ).toBeVisible();
  await management.getByRole('button', { name: 'Close repeating work', exact: true }).click();
  await expect(opener).toBeFocused();
});

test.describe('touch template layout', () => {
  test.use({ hasTouch: true });
  test('guided draft creation preserves dirty dismissal and long-document actions at every phone size', async ({
    page,
  }) => {
    const { orgId } = await workspace(page);
    await page.goto(`/orgs/${orgId}/settings/templates`, {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    await page.getByRole('button', { name: 'New template', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New project template', exact: true });
    await dialog
      .getByRole('textbox', { name: 'Template name', exact: true })
      .fill('Community dinner outline');
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    const document = dialog.getByRole('textbox', { name: 'Work description', exact: true });
    await document.fill(
      Array.from(
        { length: 18 },
        (_, i) => `Review ${i + 1}: Record the numbers, changed plans and next decisions.`,
      ).join('\n\n'),
    );
    const scroll = dialog.locator('[data-overlay-scroll-owner]');
    await expect(scroll).toHaveCount(1);
    for (const [width, height] of [
      [1440, 900],
      [320, 844],
      [390, 600],
    ]) {
      await page.setViewportSize({ width, height });
      const next = dialog.getByRole('button', { name: 'Continue', exact: true });
      await expect(next).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect.poll(() => renderedContrastRatio(next)).toBeGreaterThanOrEqual(4.5);
      }
    }
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(document).toContainText('Review 18');
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
});
