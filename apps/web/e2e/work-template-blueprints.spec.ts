import { writeFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { expect, test } from './helpers/fixtures';
import { apiJson, waitForApiResponse } from './helpers/net';
import { TIMEOUTS, myWorkHref } from './helpers/constants';
import {
  blueprintWorkspace,
  seedBlueprintTemplate,
  seedBlueprintReviewDraft,
  type BlueprintRuntimeTemplate,
} from './helpers/work-template-blueprints';

const sessionPath = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (sessionPath) test.use({ storageState: sessionPath });
async function assertCompactReview(review: Locator, title: string): Promise<void> {
  const reviewBox = await review.boundingBox();
  const childBox = await review.getByText(title, { exact: true }).boundingBox();
  expect(reviewBox).not.toBeNull();
  expect(childBox).not.toBeNull();
  if (!reviewBox || !childBox) throw new Error('Included work needs visible browser geometry.');
  expect(reviewBox.height).toBeLessThan(600);
  expect(childBox.x - reviewBox.x).toBeGreaterThanOrEqual(20);
}
interface WorkRow {
  readonly id: string;
  readonly name?: string;
  readonly title?: string;
  readonly workTypeId: string;
  readonly workTypeVersionId: string;
  readonly parentTaskId?: string | null;
  readonly programId?: string | null;
  readonly projectId?: string | null;
  readonly dueDate?: string | null;
}
async function childRows(page: Page, orgId: string, kind: 'project' | 'task'): Promise<WorkRow[]> {
  const pageOfWork = await apiJson<{ items: WorkRow[] }>(
    page,
    `/v1/orgs/${orgId}/${kind}s?limit=100`,
  );
  return pageOfWork.items;
}
async function verifyManualProjectDates(
  page: Page,
  orgId: string,
  root: WorkRow,
  child: WorkRow,
): Promise<void> {
  expect(child.dueDate).toBeNull();
  await apiJson(page, `/v1/orgs/${orgId}/projects/${root.id}`, {
    method: 'PATCH',
    body: { targetDate: '2026-10-20' },
  });
  const dated = await apiJson<WorkRow>(page, `/v1/orgs/${orgId}/tasks/${child.id}`);
  expect(dated.dueDate?.slice(0, 10)).toBe('2026-10-18');
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${child.id}`, {
    method: 'PATCH',
    body: { dueDate: '2026-10-19' },
  });
  await apiJson(page, `/v1/orgs/${orgId}/projects/${root.id}`, {
    method: 'PATCH',
    body: { targetDate: '2026-10-25' },
  });
  expect(
    (await apiJson<WorkRow>(page, `/v1/orgs/${orgId}/tasks/${child.id}`)).dueDate?.slice(0, 10),
  ).toBe('2026-10-19');
}
async function capturePrivateTemplate(
  page: Page,
  orgId: string,
  kind: string,
  root: WorkRow,
  seeded: BlueprintRuntimeTemplate,
): Promise<string> {
  await page.goto(`/orgs/${orgId}/${kind}s/${root.id}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'Save as template', exact: true }).click();
  const capture = page.getByRole('dialog', { name: 'Save as template', exact: true });
  await expect(capture.getByText(seeded.childTitle, { exact: true })).toBeVisible();
  const capturedName = `Captured ${seeded.publication.definition.name}`;
  await capture.getByRole('textbox', { name: 'Template name', exact: true }).fill(capturedName);
  const saved = waitForApiResponse(page, /\/template\/save-as$/, { method: 'POST' });
  await capture.getByRole('button', { name: 'Save private draft', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  const captured = (await (await saved).json()) as { template: WorkTemplateOut };
  expect(captured.template.scope).toBe('personal');
  expect(captured.template.latestVersion).toBeNull();
  expect(captured.template.id).not.toBe(seeded.publication.id);
  await expect(page).toHaveURL(new RegExp(`/work-templates/${captured.template.id}$`));
  await page.reload({ waitUntil: 'commit' });
  await expect(page.getByRole('tab', { name: 'Work', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Purpose', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue(
    capturedName,
  );
  expect((await apiJson<WorkRow>(page, `/v1/orgs/${orgId}/${kind}s/${root.id}`)).workTypeId).toBe(
    seeded.publication.id,
  );
  return captured.template.id;
}
for (const kind of ['initiative', 'program', 'project', 'task'] as const) {
  test(`${kind} reviews selected children, retains identity and saves an independent private template`, async ({
    page,
  }) => {
    const workspace = await blueprintWorkspace(page),
      orgId = workspace.orgId;
    const seeded = await seedBlueprintTemplate(page, orgId, kind);
    await page.goto(kind === 'task' ? myWorkHref(orgId) : `/orgs/${orgId}/${kind}s`, {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    await page
      .getByRole('button', { name: `New ${kind}`, exact: true })
      .first()
      .click();
    const composer = page.getByRole('dialog', { name: `New ${kind}`, exact: true });
    const templateControl = composer
      .getByRole('group', { name: 'Work template', exact: true })
      .getByRole('button')
      .first();
    await expect(templateControl).not.toHaveText('Templates unavailable · Retry');
    await expect(templateControl).toBeEnabled();
    await templateControl.click();
    await page
      .getByRole('menuitem', { name: new RegExp(`^${seeded.publication.definition.name}`) })
      .click();
    await page.getByRole('button', { name: 'Apply starting fields', exact: true }).click();
    await composer.getByRole('button', { name: 'Review included work', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Included work', exact: true });
    await expect(review.getByText(seeded.childTitle, { exact: true })).toBeVisible();
    await assertCompactReview(review, seeded.childTitle);
    const team = review.getByRole('combobox', { name: 'Team for included work', exact: true });
    if (await team.isVisible()) await team.selectOption(workspace.teamId);
    await review
      .getByRole('checkbox', { name: `Include ${seeded.optionalTitle}`, exact: true })
      .uncheck();
    await expect(review).toContainText('2 work items selected');
    await review.getByRole('button', { name: 'Keep these choices', exact: true }).click();
    const creation = waitForApiResponse(page, new RegExp(`/${kind}s$`), { method: 'POST' });
    await composer
      .getByRole('button', {
        name:
          kind === 'task'
            ? 'Create task'
            : `Create ${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`,
        exact: true,
      })
      .click();
    expect((await creation).ok()).toBe(true);
    const root = (await (await creation).json()) as WorkRow;
    expect(root.workTypeId).toBe(seeded.publication.id);
    expect(root.workTypeVersionId).toBe(seeded.publication.latestVersion?.id);
    const children = await childRows(page, orgId, seeded.childKind);
    const child = children.find((row) => (row.name ?? row.title) === seeded.childTitle);
    expect(child).toBeDefined();
    if (!child) throw new Error('The accepted child must be persisted.');
    expect(children.some((row) => (row.name ?? row.title) === seeded.optionalTitle)).toBe(false);
    if (kind === 'task') expect(child.parentTaskId).toBe(root.id);
    if (kind === 'project') expect(child.projectId).toBe(root.id);
    if (kind === 'program') expect(child.programId).toBe(root.id);
    if (kind === 'project') await verifyManualProjectDates(page, orgId, root, child);
    const captureId = await capturePrivateTemplate(page, orgId, kind, root, seeded);
    const evidencePath = process.env['E2E_BLUEPRINT_EVIDENCE'];
    if (evidencePath && kind === 'project') {
      const reviewDraft = await seedBlueprintReviewDraft(page, orgId, workspace.teamId, seeded);
      writeFileSync(
        evidencePath,
        JSON.stringify({
          orgId,
          rootId: root.id,
          childId: child.id,
          templateId: seeded.publication.id,
          captureId,
          reviewDraftTitle: reviewDraft.title,
          reviewDraftId: reviewDraft.id,
        }),
      );
    }
  });
}
