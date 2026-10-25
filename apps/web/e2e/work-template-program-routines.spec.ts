import { writeFileSync } from 'node:fs';
import type {
  WorkTemplateCopyReceipt,
  WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';
import type { Page } from '@playwright/test';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import type { WorkScheduleOut } from '@docket/work/work-schedule-management';
import { expect, test } from './helpers/fixtures';
import { apiJson, waitForApiResponse } from './helpers/net';
import {
  blueprintWorkspace,
  seedBlueprintTemplate,
  selectWorkDefinitionSection,
} from './helpers/work-template-blueprints';
import { TIMEOUTS } from './helpers/constants';
import { verifyCanonicalProgramSchedule } from './helpers/work-template-schedule-management';

const session = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (session) test.use({ storageState: session });

test('authors reusable Program routines and keeps created Program schedules independent', async ({
  page,
}) => {
  const workspace = await blueprintWorkspace(page);
  page.setDefaultTimeout(TIMEOUTS.ui);
  const event = await seedBlueprintTemplate(page, workspace.orgId, 'project');
  const path = `/v1/orgs/${workspace.orgId}`;
  const draft = await authorRoutine(page, workspace.orgId, event.publication.definition.name);
  const artifact = process.env['E2E_WORK_TEMPLATE_ARTIFACT'];
  if (artifact)
    writeFileSync(
      artifact,
      JSON.stringify(
        { orgId: workspace.orgId, templateId: draft.id, eventTemplateId: event.publication.id },
        null,
        2,
      ),
    );
  await reopenAndPublish(page);
  const copies = await verifyIndependentCopies(page, path, draft.id, workspace.teamId);
  const evidence = process.env['E2E_WORK_TEMPLATE_ARTIFACT'];
  if (evidence)
    writeFileSync(
      evidence,
      JSON.stringify(
        {
          orgId: workspace.orgId,
          templateId: draft.id,
          eventTemplateId: event.publication.id,
          ...copies,
        },
        null,
        2,
      ),
    );
});
test('manages canonical Program schedules and recovers a lost committed run response', async ({
  page,
}) => {
  // Signup backoff shares this budget with lifecycle and committed-response recovery.
  test.setTimeout(240_000);
  await verifyCanonicalProgramSchedule(page);
});

async function authorRoutine(
  page: Page,
  orgId: string,
  eventName: string,
): Promise<WorkTemplateOut> {
  await page.goto(`/orgs/${orgId}/work-templates/new`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('combobox', { name: 'Kind of work', exact: true }).selectOption('program');
  await page
    .getByRole('textbox', { name: 'Template name', exact: true })
    .fill('Community gatherings');
  await page
    .getByRole('textbox', { name: 'When to use it', exact: true })
    .fill('Operate a regular neighborhood dinner with preparation and follow-up.');
  await page.getByRole('button', { name: 'Continue to starting work', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Document', exact: true })
    .fill(
      '## Welcome the neighborhood\n\nPlan accessible gatherings and record what the next host needs.',
    );
  await page.getByRole('button', { name: 'Continue to included work', exact: true }).click();
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const child = page.getByRole('group', { name: /^Child work:/ });
  await child.getByRole('textbox', { name: 'Title', exact: true }).fill('Prepare host handover');
  await child.getByRole('button', { name: 'Responsibility', exact: true }).click();
  await child
    .getByRole('combobox', { name: 'Responsible person', exact: true })
    .selectOption('parent_responsible');
  await child.getByRole('button', { name: 'Add subtask', exact: true }).click();
  const nested = page.getByRole('group', { name: /^Child work:/ });
  await nested.getByRole('textbox', { name: 'Title', exact: true }).fill('Confirm the next host');
  await nested.getByRole('button', { name: 'Dates', exact: true }).click();
  await nested.getByRole('combobox', { name: 'Is due', exact: true }).selectOption('parent');
  await nested.getByRole('button', { name: 'Back to included work', exact: true }).click();
  await page.getByRole('button', { name: 'Add repeating work', exact: true }).click();
  await page
    .getByRole('region', { name: 'Work to repeat', exact: true })
    .getByRole('button')
    .click();
  await page.getByRole('menuitem', { name: new RegExp(`^${eventName}`) }).click();
  await page
    .getByRole('textbox', { name: 'Repeating work name', exact: true })
    .fill('Monthly community dinner');
  await page
    .getByRole('textbox', { name: 'Title for each new item', exact: true })
    .fill('{month} community dinner');
  await page
    .getByRole('combobox', { name: 'Monthly repeat pattern', exact: true })
    .selectOption('nth_weekday');
  await page
    .getByRole('combobox', { name: 'Monthly weekday position', exact: true })
    .selectOption('2');
  await page
    .getByRole('combobox', { name: 'Monthly weekday', exact: true })
    .selectOption('thursday');
  await page.getByRole('combobox', { name: 'First occurrence', exact: true }).selectOption('after');
  await page
    .getByRole('spinbutton', { name: 'Days before or after creation', exact: true })
    .fill('7');
  await selectWorkDefinitionSection(page, 'Review');
  await expect(page.getByRole('region', { name: 'Repeating work review' })).toContainText(
    'Begins 7 days after Program creation',
  );
  const saving = waitForApiResponse(page, /\/templates\/definitions$/, { method: 'POST' });
  await page.getByRole('button', { name: /^Save (draft|changes)$/ }).click();
  const draft = (await (await saving).json()) as WorkTemplateOut;
  await expect(page).toHaveURL(new RegExp(`/work-templates/${draft.id}(?:\\?|$)`));
  return draft;
}
async function reopenAndPublish(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'commit' });
  await selectWorkDefinitionSection(page, 'Included work');
  await page
    .getByRole('button', { name: 'Edit repeating work Monthly community dinner', exact: true })
    .click();
  await expect(
    page.getByRole('spinbutton', { name: 'Days before or after creation', exact: true }),
  ).toHaveValue('7');
  await page.getByRole('button', { name: 'Back to included work', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit repeating work Monthly community dinner', exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const branch = page.getByRole('button', { name: 'Created together', exact: true });
  await branch.focus();
  await page.keyboard.press('Enter');
  await expect(branch).toHaveAttribute('aria-expanded', 'false');
  await expect(
    page.getByRole('button', { name: 'Edit repeating work Monthly community dinner', exact: true }),
  ).toBeInViewport();
  await page
    .getByRole('button', { name: 'Edit repeating work Monthly community dinner', exact: true })
    .click();
  await page.getByRole('button', { name: 'Back to included work', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit repeating work Monthly community dinner', exact: true }),
  ).toBeFocused();
  await expect(branch).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 1440, height: 900 });
  await selectWorkDefinitionSection(page, 'Review');
  const publication = waitForApiResponse(page, /\/publish$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Publish to workspace', exact: true }).click();
  expect((await publication).ok()).toBe(true);
}
async function verifyIndependentCopies(
  page: Page,
  path: string,
  templateId: string,
  teamId: string,
) {
  const body = {
    name: 'Neighborhood gatherings',
    workTypeId: templateId,
    blueprint: { optionalChoices: [], creationTeamId: teamId },
  };
  const first = await createReviewedProgram(page, path, teamId);
  const second = await apiJson<{ id: string }>(page, `${path}/programs`, {
    method: 'POST',
    body: { ...body, name: 'Another neighborhood' },
  });
  const list = (programId: string) =>
    apiJson<{ items: WorkScheduleOut[] }>(
      page,
      `${path}/work-schedules?ownerProgramId=${programId}`,
    );
  const left = (await list(first.id)).items;
  const right = (await list(second.id)).items;
  expect(left).toHaveLength(1);
  expect(right).toHaveLength(1);
  expect(left[0]?.id).not.toBe(right[0]?.id);
  await page.goto(`/orgs/${path.split('/').at(-1)}/work-templates/${templateId}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await selectWorkDefinitionSection(page, 'Included work');
  await page
    .getByRole('button', { name: 'Edit repeating work Monthly community dinner', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Repeating work name', exact: true })
    .fill('A different future routine');
  const edit = waitForApiResponse(page, /\/draft$/, { method: 'PATCH' });
  await page.getByRole('button', { name: /^Save (draft|changes)$/ }).click();
  expect((await edit).ok()).toBe(true);
  await selectWorkDefinitionSection(page, 'Review');
  const republish = waitForApiResponse(page, /\/publish$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Publish next version', exact: true }).click();
  expect((await republish).ok()).toBe(true);
  expect((await list(first.id)).items).toEqual(left);
  expect((await list(second.id)).items).toEqual(right);
  const third = await apiJson<{ id: string }>(page, `${path}/programs`, {
    method: 'POST',
    body: { ...body, name: 'Future neighborhood' },
  });
  expect((await list(third.id)).items[0]?.name).toBe('A different future routine');
  await page.goto(`/orgs/${path.split('/').at(-1)}/programs/${first.id}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('tab', { name: 'Schedules', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit future runs for Monthly community dinner', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: 'Edit future runs', exact: true });
  await editor
    .getByRole('textbox', { name: 'Schedule name', exact: true })
    .fill('First neighborhood only');
  await editor.getByRole('tab', { name: 'Review', exact: true }).click();
  const revised = waitForApiResponse(page, /\/work-schedules\/[^/]+\/revisions$/, {
    method: 'POST',
  });
  await editor.getByRole('button', { name: 'Save future runs', exact: true }).click();
  expect((await revised).ok()).toBe(true);
  await expect(editor).not.toBeVisible();
  expect((await list(first.id)).items[0]?.name).toBe('First neighborhood only');
  expect((await list(second.id)).items).toEqual(right);
  return { programIds: [first.id, second.id, third.id], scheduleIds: [left[0]?.id, right[0]?.id] };
}

async function createReviewedProgram(
  page: Page,
  path: string,
  teamId: string,
): Promise<{ id: string }> {
  const orgId = path.split('/').at(-1);
  await page.goto(`/orgs/${orgId}/programs`, { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
  await page.getByRole('button', { name: 'New program', exact: true }).first().click();
  const composer = page.getByRole('dialog', { name: 'New program', exact: true });
  await composer
    .getByRole('group', { name: 'Work template', exact: true })
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('menuitem', { name: /^Community gatherings/ }).click();
  await page.getByRole('button', { name: 'Apply starting fields', exact: true }).click();
  await composer.getByPlaceholder('Program name', { exact: true }).fill('Neighborhood gatherings');
  await composer.getByRole('button', { name: 'Review included work', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Included work', exact: true });
  await review
    .getByRole('combobox', { name: 'Team for included work', exact: true })
    .selectOption(teamId);
  await expect(
    review.getByRole('heading', { name: 'Independent schedules', exact: true }),
  ).toBeVisible();
  await expect(review).toContainText('Monthly community dinner');
  await expect(review).toContainText(/First run \d{4}-\d{2}-\d{2}/);
  await expect(
    review.getByRole('list', { name: 'Work creation consequences', exact: true }),
  ).toContainText(/needs? a date anchor/);
  await review.getByRole('button', { name: 'Keep these choices', exact: true }).click();
  const creation = waitForApiResponse(page, /\/programs$/, { method: 'POST' });
  await composer.getByRole('button', { name: 'Create Program', exact: true }).click();
  const response = await creation;
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string };
}

test('keeps recurring work and the work outline reachable while reading a long Program definition', async ({
  page,
}) => {
  const workspace = await blueprintWorkspace(page);
  page.setDefaultTimeout(TIMEOUTS.ui);
  const event = await seedBlueprintTemplate(page, workspace.orgId, 'project');
  const path = `/v1/orgs/${workspace.orgId}/templates/definitions`;
  const draft = await apiJson<WorkTemplateOut>(page, path, {
    method: 'POST',
    body: {
      targetType: 'program',
      scope: 'personal',
      offeredTeamIds: [],
      definition: {
        name: 'Neighborhood gatherings operating guide',
        payload: {
          targetType: 'program',
          description: `${Array.from({ length: 20 }, (_, index) => `## Host preparation ${index + 1}\n\nConfirm the gathering is accessible, share the responsibilities, and record arrangements for the next host.`).join('\n\n')}\n\nFinal host note`,
        },
        blueprint: {
          steps: Array.from({ length: 24 }, (_, index) => ({
            key: `host-${index}`,
            kind: 'task',
            parentStepKey: null,
            sort: index,
            fields: { title: `Host preparation requirement ${index + 1}` },
            template: null,
            optional: { enabled: false, selectedByDefault: true },
            teamRule: 'creation_team',
            actorRule: 'creator',
            cycleRule: 'none',
            dates: {},
          })),
          dependencies: [],
        },
        defaultSchedules: [
          {
            key: 'dinner',
            name: 'Monthly community dinner',
            template: {
              targetType: 'project',
              workTypeId: event.publication.id,
              selection: { kind: 'latest' },
            },
            titlePattern: '{month} community dinner',
            cadence: {
              kind: 'monthly',
              interval: 1,
              startOffsetDays: 0,
              end: { kind: 'never' },
              pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
            },
            teamRule: 'parent_team',
            actorRule: 'parent_responsible',
          },
        ],
      },
    },
  });
  await page.goto(`/orgs/${workspace.orgId}/work-templates/${draft.id}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await selectWorkDefinitionSection(page, 'Starting work');
  await page.getByText('Final host note', { exact: true }).scrollIntoViewIfNeeded();
  await selectWorkDefinitionSection(page, 'Included work');
  const branch = page.getByRole('button', { name: 'Created together', exact: true });
  const routine = page.getByRole('button', {
    name: 'Edit repeating work Monthly community dinner',
    exact: true,
  });
  for (const viewport of [
    { width: 390, height: 600 },
    { width: 320, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(branch).toHaveAttribute('aria-expanded', 'true');
    await routine.click();
    await expect(branch).not.toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Child work outline', exact: true }),
    ).not.toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Document', exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Back to included work', exact: true }).click();
    await expect(branch).toHaveAttribute('aria-expanded', 'true');
    await expect(routine).toBeFocused();
    await expect(routine).toBeInViewport();
  }
  await page.setViewportSize({ width: 390, height: 600 });
  await branch.click();
  await expect(branch).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Included work summary')).toHaveText('24 included items');
  await page.getByRole('button', { name: 'Add repeating work', exact: true }).click();
  await page.getByRole('button', { name: 'Back to included work', exact: true }).click();
  const overview = page.getByRole('heading', { name: 'Included work', exact: true });
  await expect(overview).toBeFocused();
  await expect(overview).toBeInViewport();
  await expect(branch).toHaveAttribute('aria-expanded', 'false');
  await routine.click();
  await page.getByRole('button', { name: 'Remove repeating work', exact: true }).click();
  await expect(overview).toBeFocused();
  await expect(overview).toBeInViewport();
  await expect(branch).toHaveAttribute('aria-expanded', 'false');
  await expect(routine).toHaveCount(0);
});

test('a copied private Program keeps its routine publication pin and returns from linked draft review', async ({
  page,
}) => {
  const { orgId } = await blueprintWorkspace(page);
  const api = `/v1/orgs/${orgId}/templates/definitions`;
  const choices = {
    release: 1,
    roots: ['event-series'],
    mode: 'private_drafts',
    labels: [],
    offerings: [],
  };
  const preview = await apiJson<WorkTemplateGalleryPreview>(page, `${api}/gallery/copy-preview`, {
    method: 'POST',
    body: choices,
  });
  const receipt = await apiJson<WorkTemplateCopyReceipt>(page, `${api}/gallery/copies`, {
    method: 'POST',
    body: {
      ...choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: preview.reviewFingerprint,
    },
  });
  const root = receipt.roots[0];
  if (!root) throw new Error('The copied Program is missing.');
  const program = await apiJson<WorkTemplateOut>(page, `${api}/${root.workTypeId}`);
  const routine = program.definition.defaultSchedules[0];
  if (!routine) throw new Error('The copied Program routine is missing.');
  const linked = await apiJson<WorkTemplateOut>(page, `${api}/${routine.template.workTypeId}`);
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto(`/orgs/${orgId}/work-templates/${program.id}?section=structure`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page
    .getByRole('button', { name: `Edit repeating work ${routine.name}`, exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: `Unpublished ${linked.definition.name}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Template updates for repeating work', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Repeat interval', exact: true }).fill('2');
  const saved = waitForApiResponse(page, /\/draft$/, { method: 'PATCH' });
  await page.getByRole('button', { name: /^Save (draft|changes)$/ }).click();
  expect((await saved).ok()).toBe(true);
  const persisted = await apiJson<WorkTemplateOut>(page, `${api}/${program.id}`);
  expect(persisted.draftDefinition?.defaultSchedules[0]?.template.selection).toEqual(
    routine.template.selection,
  );
  const review = page.getByRole('link', { name: `Review ${linked.definition.name}`, exact: true });
  await expect(review).toHaveAttribute(
    'href',
    `/orgs/${orgId}/work-templates/${linked.id}?section=review&returnTo=${program.id}&returnContext=section%3Dstructure`,
  );
  await review.click();
  await expect(
    page.getByRole('heading', { level: 1, name: linked.definition.name, exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to parent template', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: program.definition.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator('[role="tab"][aria-label="Review"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
