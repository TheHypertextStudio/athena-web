import { writeFileSync } from 'node:fs';
import { WorkTemplateDefinition, type WorkTemplateOut } from '@docket/work/work-template-contract';
import { expect, test } from './helpers/fixtures';
import { apiJson, waitForApiResponse } from './helpers/net';
import { TIMEOUTS } from './helpers/constants';
import type { Page } from '@playwright/test';
import type { BlueprintCreationPreview } from '@docket/work/work-template-blueprint';
import { blueprintWorkspace, seedBlueprintTemplate } from './helpers/work-template-blueprints';

const sessionPath = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (sessionPath) test.use({ storageState: sessionPath });

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly workTypeVersionId: string;
}
interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly dueDate: string | null;
  readonly projectId: string | null;
}

async function createReviewedProject(
  page: Page,
  orgId: string,
  request: {
    readonly name: string;
    readonly description: string;
    readonly targetDate: string;
    readonly teamId: string;
    readonly workTypeId: string;
    readonly workTypeVersionId: string;
    readonly blueprint: {
      readonly creationTeamId: string;
      readonly optionalChoices: readonly {
        readonly path: readonly string[];
        readonly selected: boolean;
      }[];
    };
  },
): Promise<ProjectRow> {
  const { blueprint: options, ...body } = request;
  const review = await apiJson<BlueprintCreationPreview>(
    page,
    `/v1/orgs/${orgId}/templates/definitions/${body.workTypeId}/blueprint-preview`,
    { method: 'POST', body: { kind: 'project', body, options } },
  );
  return apiJson<ProjectRow>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { ...body, blueprint: { ...options, previewToken: review.previewToken } },
  });
}

test('updates a published blueprint selectively while preserving authored notes and manual dates', async ({
  page,
}) => {
  const workspace = await blueprintWorkspace(page),
    orgId = workspace.orgId;
  const seeded = await seedBlueprintTemplate(page, orgId, 'project');
  const publication = seeded.publication;
  const versionOne = publication.latestVersion?.id;
  if (!versionOne) throw new Error('Published fixture must have a version.');
  const createBody = {
    name: 'Neighborhood dinner with authored notes',
    description: 'Keep this local decision: welcome neighbors at the south entrance.',
    targetDate: '2026-10-20',
    teamId: workspace.teamId,
    workTypeId: publication.id,
    workTypeVersionId: versionOne,
    blueprint: {
      creationTeamId: workspace.teamId,
      optionalChoices: [{ path: ['optional'], selected: false }],
    },
  };
  const project = await createReviewedProject(page, orgId, createBody);
  const tasks = await apiJson<{ items: TaskRow[] }>(page, `/v1/orgs/${orgId}/tasks?limit=100`);
  const original = tasks.items.find((row) => row.title === seeded.childTitle);
  if (!original) throw new Error('Preparation work must exist.');
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${original.id}`, {
    method: 'PATCH',
    body: { dueDate: '2026-10-19' },
  });
  const baseStep = publication.definition.blueprint.steps[0];
  if (baseStep?.kind !== 'task') throw new Error('Project fixture must contain a Task step.');
  const additionTitle = 'Confirm the accessible entrance and send neighbors the arrival details';
  const definition = WorkTemplateDefinition.parse({
    ...publication.definition,
    blueprint: {
      ...publication.definition.blueprint,
      steps: [
        ...publication.definition.blueprint.steps,
        {
          ...baseStep,
          key: 'arrival',
          sort: 2,
          fields: { title: additionTitle },
        },
      ],
    },
  });
  const definitionsPath = `/v1/orgs/${orgId}/templates/definitions/${publication.id}`;
  const edited = await apiJson<WorkTemplateOut>(page, `${definitionsPath}/draft`, {
    method: 'PATCH',
    body: { expectedRevision: publication.revision, definition },
  });
  const versionTwo = await apiJson<WorkTemplateOut>(page, `${definitionsPath}/publish`, {
    method: 'POST',
    body: { expectedRevision: edited.revision },
  });
  await page.goto(`/orgs/${orgId}/projects/${project.id}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'Update template', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Update template', exact: true });
  await expect(review).toContainText('Version 2');
  await review
    .getByRole('checkbox', { name: `Add ${additionTitle} (1 item)`, exact: true })
    .check();
  const applied = waitForApiResponse(page, /\/template\/update$/, { method: 'POST' });
  await review.getByRole('button', { name: 'Update template', exact: true }).click();
  expect((await applied).ok()).toBe(true);
  const updated = await apiJson<ProjectRow>(page, `/v1/orgs/${orgId}/projects/${project.id}`);
  expect(updated.workTypeVersionId).toBe(versionTwo.latestVersion?.id);
  expect(updated.description).toBe(createBody.description);
  expect(
    (await apiJson<TaskRow>(page, `/v1/orgs/${orgId}/tasks/${original.id}`)).dueDate?.slice(0, 10),
  ).toBe('2026-10-19');
  const updatedTasks = await apiJson<{ items: TaskRow[] }>(
    page,
    `/v1/orgs/${orgId}/tasks?limit=100`,
  );
  expect(
    updatedTasks.items.filter((row) => row.projectId === project.id && row.title === additionTitle),
  ).toHaveLength(1);
  const evidencePath = process.env['E2E_BLUEPRINT_UPDATE_EVIDENCE'];
  if (evidencePath) {
    const retained = await createReviewedProject(page, orgId, {
      ...createBody,
      name: 'Dinner template update review',
    });
    writeFileSync(
      evidencePath,
      JSON.stringify({ orgId, rootId: retained.id, templateId: publication.id }),
    );
  }
});
