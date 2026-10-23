import type { Page } from '@playwright/test';
import type { RecurrenceSeriesDetailOut } from '../src/lib/contracts/recurrence';

import { signUpAndOnboard } from './helpers/app';
import { TIMEOUTS } from './helpers/constants';
import { renderedContrastRatio } from './helpers/calendar-ui';
import { expect, test } from './helpers/fixtures';
import { createMobileAuditFixture, type MobileAuditFixture } from './helpers/mobile-audit-fixture';
import {
  blueprintWorkspace,
  selectWorkDefinitionSection,
} from './helpers/work-template-blueprints';
import { apiJson, waitForApiResponse } from './helpers/net';

const sessionPath = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (sessionPath) test.use({ storageState: sessionPath });

/** Reuse an explicit local audit session, or create an isolated account through the normal ceremony. */
async function workspace(
  page: Page,
): Promise<{ orgId: string; fixture?: MobileAuditFixture | undefined }> {
  page.setDefaultTimeout(TIMEOUTS.ui);
  if (sessionPath) {
    const fixture = await blueprintWorkspace(page);
    return { orgId: fixture.orgId, fixture };
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
    await page.goto(`/orgs/${orgId}/work-templates`, {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    const suffix = Date.now();
    const name = `${kind} workflow ${suffix}`;
    await page.getByRole('link', { name: 'Define work', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
    await page
      .getByRole('combobox', { name: 'Kind of work', exact: true })
      .selectOption(kind.toLocaleLowerCase());
    await page.getByRole('textbox', { name: 'Template name', exact: true }).fill(name);
    await page
      .getByRole('textbox', { name: 'When to use it', exact: true })
      .fill(`Reusable ${kind.toLocaleLowerCase()} starting fields.`);
    await page.getByRole('button', { name: 'Continue to starting work', exact: true }).click();
    const starting = kind === 'Task' ? 'Starting title' : 'Starting name';
    await page.getByRole('textbox', { name: starting, exact: true }).fill(`${kind} starting name`);
    await page
      .getByRole('textbox', { name: 'Starting document', exact: true })
      .fill('Record the goal, owner, and next action.');
    const saved = waitForApiResponse(page, /\/templates\/definitions$/, { method: 'POST' });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const draft = (await response.json()) as { id: string; scope: string; status: string };
    expect(draft.scope).toBe('personal');
    expect(draft.status).toBe('draft');
    await expect(page).toHaveURL(new RegExp(`/work-templates/${draft.id}$`));
    await expect(page.locator('[role="tab"][aria-label="Starting work"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('textbox', { name: starting, exact: true })).toHaveValue(
      `${kind} starting name`,
    );
    await selectWorkDefinitionSection(page, 'Purpose');
    const renamed = `${name} revised`;
    await page.getByRole('textbox', { name: 'Template name', exact: true }).fill(renamed);
    await page.getByRole('textbox', { name: 'When to use it', exact: true }).fill('');
    const updated = waitForApiResponse(page, /\/draft$/, { method: 'PATCH' });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    expect((await updated).ok()).toBe(true);
    await page.reload({ waitUntil: 'commit' });
    await expect(page.locator('[role="tab"][aria-label="Starting work"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await selectWorkDefinitionSection(page, 'Purpose');
    await expect(page.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue(
      renamed,
    );
    await expect(page.getByRole('textbox', { name: 'When to use it', exact: true })).toHaveValue(
      '',
    );
    await selectWorkDefinitionSection(page, 'Starting work');
    await expect(
      page.getByRole('textbox', { name: 'Starting document', exact: true }),
    ).toContainText('Record the goal, owner, and next action.');
    await selectWorkDefinitionSection(page, 'Review');
    const publication = waitForApiResponse(page, /\/publish$/, { method: 'POST' });
    await page.getByRole('button', { name: 'Publish to workspace', exact: true }).click();
    expect((await publication).ok()).toBe(true);
    await page.getByRole('button', { name: 'Published history', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Version 1', exact: true })).toBeVisible();
  });
}

test('a project repeats through persisted setup and future revisions preserve occurrence history', async ({
  page,
}) => {
  const initial = await workspace(page);
  const fixture = initial.fixture ?? (await createMobileAuditFixture(page));
  const orgId = fixture.orgId;
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: {
      name: `Repeatable community dinner ${Date.now()}`,
      teamId: fixture.teamId,
      leadId: fixture.ownerActorId,
      programId: fixture.programId,
      description: 'Prepare a welcoming community dinner and record the outcome.',
    },
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: {
      title: 'Confirm the venue and volunteer roles',
      teamId: fixture.teamId,
      projectId: project.id,
      assigneeId: fixture.ownerActorId,
    },
  });
  await page.goto(`/orgs/${orgId}/projects/${project.id}`, {
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

test('repeat setup recovers lost committed responses without duplicating definitions or series', async ({
  page,
}) => {
  const initial = await workspace(page);
  const fixture = initial.fixture ?? (await createMobileAuditFixture(page));
  const orgId = fixture.orgId;
  const project = await apiJson<{ id: string; name: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: {
      name: `Weekly review recovery ${Date.now()}`,
      teamId: fixture.teamId,
      leadId: fixture.ownerActorId,
    },
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Review progress', teamId: fixture.teamId, projectId: project.id },
  });
  const committed = new Map<string, string>();
  for (const endpoint of ['process-definitions/from-project', 'recurrence-series']) {
    await page.route(
      `**/v1/orgs/${orgId}/${endpoint}`,
      async (route) => {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const result = (await response.json()) as { id: string };
        committed.set(endpoint, result.id);
        // The server has committed, but the caller receives no response to acknowledge it.
        await route.abort('failed');
      },
      { times: 1 },
    );
  }
  await page.goto(`/orgs/${orgId}/projects/${project.id}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Repeat project', exact: true }).click();
  const setup = page.getByRole('dialog').last();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await changeCadence(page, 'daily');
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  const start = setup.getByRole('button', { name: 'Start repeating', exact: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await start.click();
    await expect(setup.getByText('Could not finish setup', { exact: true })).toBeVisible();
    await expect(start).toBeEnabled();
  }
  expect(committed.size).toBe(2);
  await start.click();
  await expect(page).toHaveURL(
    new RegExp(`/recurrence-series/${committed.get('recurrence-series')}$`),
  );
  const definitions = await apiJson<{ items: { id: string; name: string }[] }>(
    page,
    `/v1/orgs/${orgId}/process-definitions?limit=100`,
  );
  expect(
    definitions.items
      .filter((item) => item.name === `${project.name} series`)
      .map((item) => item.id),
  ).toEqual([committed.get('process-definitions/from-project')]);
  const series = await apiJson<{ items: { id: string; name: string }[] }>(
    page,
    `/v1/orgs/${orgId}/recurrence-series?limit=100`,
  );
  expect(
    series.items.filter((item) => item.name === `${project.name} series`).map((item) => item.id),
  ).toEqual([committed.get('recurrence-series')]);
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
  test('guided draft creation preserves unsaved navigation and warns on document dismissal and long-document actions at every phone size', async ({
    page,
  }) => {
    const { orgId } = await workspace(page);
    await page.goto(`/orgs/${orgId}/work-templates`, {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    await page.getByRole('link', { name: 'Define work', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Template name', exact: true })
      .fill('Community dinner outline');
    await page.getByRole('button', { name: 'Continue to starting work', exact: true }).click();
    const bodyEditor = page.getByRole('textbox', { name: 'Starting document', exact: true });
    await bodyEditor.fill(
      Array.from(
        { length: 18 },
        (_, i) => `Review ${i + 1}: Record the numbers, changed plans and next decisions.`,
      ).join('\n\n'),
    );
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
    for (const [width, height] of [
      [1440, 900],
      [320, 844],
      [390, 600],
    ] as const) {
      await page.setViewportSize({ width, height });
      const next = page.getByRole('button', { name: 'Save draft', exact: true });
      await next.scrollIntoViewIfNeeded();
      await expect(next).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect.poll(() => renderedContrastRatio(next)).toBeGreaterThanOrEqual(4.5);
      }
    }
    await page.getByRole('link', { name: 'Back to Work templates', exact: true }).click();
    await page.getByRole('link', { name: 'Define work', exact: true }).click();
    await selectWorkDefinitionSection(page, 'Starting work');
    await expect(bodyEditor).toContainText('Review 18');
    await selectWorkDefinitionSection(page, 'Purpose');
    await expect(page.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue(
      'Community dinner outline',
    );
    // Reload is a document dismissal; the browser must warn before losing unsaved in-memory input.
    const warning = page.waitForEvent('dialog');
    const reload = page.reload({ waitUntil: 'commit' }).catch(() => undefined);
    const prompt = await warning;
    expect(prompt.type()).toBe('beforeunload');
    await prompt.dismiss();
    await reload;
    await selectWorkDefinitionSection(page, 'Starting work');
    await expect(bodyEditor).toContainText('Review 18');
  });
});
