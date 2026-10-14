import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { TemplateOut } from '@docket/work/template-contract';
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

async function openTemplate(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
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
    const saved = waitForApiResponse(page, /\/templates$/, { method: 'POST' });
    await dialog.getByRole('button', { name: 'Create template', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(dialog).not.toBeVisible();
    await openTemplate(page, name);
    const editing = page.getByRole('dialog', { name: name, exact: true });
    await expect(editing.getByRole('tab', { name: 'Work', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(editing.getByRole('textbox', { name: title, exact: true })).toHaveValue(
      `${kind} starting name`,
    );
    await expect(
      editing.getByRole('textbox', { name: 'Work description', exact: true }),
    ).toContainText('Record the goal, owner, and next action.');
    await editing.getByRole('tab', { name: 'Basics', exact: true }).click();
    const renamed = `${name} revised`;
    await editing.getByRole('textbox', { name: 'Template name', exact: true }).fill(renamed);
    await editing.getByRole('textbox', { name: 'When to use it', exact: true }).fill('');
    await editing.getByRole('button', { name: /^Shared with —/ }).click();
    await page.getByRole('option', { name: 'Only you', exact: true }).click();
    const updated = waitForApiResponse(page, /\/templates\/[^/]+$/, { method: 'PATCH' });
    await editing.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await updated).ok()).toBe(true);
    await expect(editing).not.toBeVisible();
    await page.reload({ waitUntil: 'commit' });
    await openTemplate(page, renamed);
    const reopened = page.getByRole('dialog', { name: renamed, exact: true });
    await reopened.getByRole('tab', { name: 'Basics', exact: true }).click();
    await expect(
      reopened.getByRole('textbox', { name: 'When to use it', exact: true }),
    ).toHaveValue('');
    const templates = await apiJson<{ items: TemplateOut[] }>(page, `/v1/orgs/${orgId}/templates`);
    const persisted = templates.items.find((item) => item.name === renamed);
    expect(persisted?.scope).toBe('personal');
    expect(persisted?.targetType).toBe(kind.toLowerCase());
    await reopened.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(reopened).not.toBeVisible();
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
  test('short template setup stays compact and long documents scroll without hiding actions', async ({
    page,
  }) => {
    const { orgId } = await workspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/orgs/${orgId}/settings/templates`, {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    await openTemplate(page, 'Running a business');
    const short = page.getByRole('dialog', { name: 'Running a business', exact: true });
    const shortBounds = await short.boundingBox();
    expect(shortBounds?.height).toBeLessThan(700);
    const description = short.getByRole('textbox', { name: 'Work description', exact: true });
    const fieldBounds = await description.boundingBox();
    const saveBounds = await short
      .getByRole('button', { name: 'Save changes', exact: true })
      .boundingBox();
    if (!fieldBounds || !saveBounds)
      throw new Error('The document and save action must be visible.');
    expect(saveBounds.y - (fieldBounds.y + fieldBounds.height)).toBeGreaterThanOrEqual(0);
    expect(saveBounds.y - (fieldBounds.y + fieldBounds.height)).toBeLessThan(70);
    expect(
      await short
        .locator('[data-overlay-scroll-owner]')
        .evaluate((el) => el.scrollHeight <= el.clientHeight),
    ).toBe(true);
    await description.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' A draft note.');
    await page.keyboard.press('Escape');
    await short.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(description).toBeFocused();
    await page.keyboard.press('Escape');
    await short.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(short).not.toBeVisible();

    const blankName = 'Blank project setup';
    const longName =
      'Monthly finance review for the business, the nonprofit, and each team that needs to report its progress and next decisions';
    const body = Array.from(
      { length: 18 },
      (_, i) =>
        `## Review ${i + 1}\n\nRecord the numbers, discuss what changed, and agree on the next actions.\n\n- Check the current budget.\n- Record the decision and owner.`,
    ).join('\n\n');
    const existing = await apiJson<{ items: TemplateOut[] }>(page, `/v1/orgs/${orgId}/templates`);
    for (const [name, description] of [
      [blankName, ''],
      [longName, body],
    ]) {
      const saved = existing.items.find((item) => item.name === name);
      await apiJson<TemplateOut>(
        page,
        `/v1/orgs/${orgId}/templates${saved ? `/${saved.id}` : ''}`,
        {
          method: saved ? 'PATCH' : 'POST',
          body: {
            name,
            description: '',
            scope: 'personal',
            targetType: 'project',
            payload: { targetType: 'project', description, status: 'planned' },
          },
        },
      );
    }
    await page.reload({ waitUntil: 'commit' });
    await openTemplate(page, longName);
    const long = page.getByRole('dialog', { name: longName, exact: true });
    const scroll = long.locator('[data-overlay-scroll-owner]');
    await expect(scroll).toHaveCount(1);
    await expect.poll(() => scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(long.getByRole('textbox', { name: 'Work description' })).toContainText(
      'Review 18',
    );
    await expect(long.getByRole('button', { name: 'Save changes', exact: true })).toBeInViewport();
    const nested = await long.evaluate(
      (el) =>
        Array.from(el.querySelectorAll('*')).filter((node) => {
          const style = getComputedStyle(node);
          return (
            ['auto', 'scroll'].includes(style.overflowY) && node.scrollHeight > node.clientHeight
          );
        }).length,
    );
    expect(nested).toBe(1);
    await long.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(long).not.toBeVisible();
    for (const height of [844, 600]) {
      await page.setViewportSize({ width: height === 844 ? 320 : 390, height });
      await openTemplate(page, blankName);
      const blank = page.getByRole('dialog', { name: blankName, exact: true });
      await expect(
        blank.getByRole('button', { name: 'Save changes', exact: true }),
      ).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const save = blank.getByRole('button', { name: 'Save changes', exact: true });
      await expect.poll(async () => (await save.boundingBox())?.height).toBeGreaterThanOrEqual(40);
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect.poll(() => renderedContrastRatio(save)).toBeGreaterThanOrEqual(4.5);
      }
      await blank.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(blank).not.toBeVisible();
    }
  });
});
