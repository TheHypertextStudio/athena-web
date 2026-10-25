/** Refusal, delegation, and reconstruction paths of process-definition authoring. */
import {
  invocationHead,
  milestone,
  processDefinition,
  processDependency,
  processMilestoneSpec,
  processProjectSpec,
  processRevision,
  processStep,
  project,
  projectLabel,
  task,
  taskDependency,
  taskLabel,
  team,
} from '@docket/db';
import { getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProcessDefinitionCreate,
  ProcessDefinitionFromProjectCreate,
} from '../../src/contracts/recurrence';
import { ConflictError, NotFoundError } from '../../src/error';
import type * as LegacyDefinitionAccess from '../../src/lib/recurrence/legacy-definition-access';
import type * as TaskTemplateIdentity from '../../src/lib/recurrence/task-template-identity';
import type * as TemplateService from '../../src/lib/templates/service';
import {
  appendPublishedProcessRevision,
  createProcessDefinitionFromProjectInTransaction,
  createPublishedProcessDefinition,
  loadProcessDefinitionDetail,
} from '../../src/lib/recurrence/process-definition';
import { queryFake, routedQueryFake } from './recurrence-query-fake';

const mocks = vi.hoisted(() => ({
  enforced: vi.fn(),
  createPrivate: vi.fn(),
  appendPrivate: vi.fn(),
  createPrivateInTransaction: vi.fn(),
  definitionAccess: vi.fn(),
  canonicalDetail: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('../../src/lib/recurrence/private-alias-references', () => ({
  canonicalAliasReferencesEnforced: mocks.enforced,
}));
vi.mock('../../src/lib/recurrence/private-definition-publication', () => ({
  createCanonicalPrivateDefinition: mocks.createPrivate,
  appendCanonicalPrivateDefinition: mocks.appendPrivate,
  createCanonicalPrivateDefinitionInTransaction: mocks.createPrivateInTransaction,
}));
vi.mock('../../src/lib/recurrence/legacy-definition-access', async (importOriginal) => ({
  ...(await importOriginal<typeof LegacyDefinitionAccess>()),
  requireLegacyDefinitionAccess: mocks.definitionAccess,
}));
vi.mock('../../src/lib/recurrence/canonical-definition', () => ({
  canonicalDefinitionDetail: mocks.canonicalDetail,
}));
vi.mock('../../src/lib/recurrence/task-template-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof TaskTemplateIdentity>()),
  prepareProcessTemplates: (_database: unknown, _organizationId: string, definition: unknown) =>
    Promise.resolve(definition),
}));
vi.mock('../../src/lib/templates/service', async (importOriginal) => ({
  ...(await importOriginal<typeof TemplateService>()),
  reconcileTemplateCreationEffects: mocks.reconcile,
}));

const organizationId = '01BX5ZZKBKACTAV9WEVGEMMV10';
const actorId = '01BX5ZZKBKACTAV9WEVGEMMV11';
const definitionId = '01BX5ZZKBKACTAV9WEVGEMMV12';
const revisionId = '01BX5ZZKBKACTAV9WEVGEMMV13';
const teamId = '01BX5ZZKBKACTAV9WEVGEMMV14';
const projectId = '01BX5ZZKBKACTAV9WEVGEMMV16';
const otherProjectId = '01BX5ZZKBKACTAV9WEVGEMMV17';
const milestoneId = '01BX5ZZKBKACTAV9WEVGEMMV18';
const leadId = '01BX5ZZKBKACTAV9WEVGEMMV19';
const programId = '01BX5ZZKBKACTAV9WEVGEMMV1A';
const firstTaskId = '01BX5ZZKBKACTAV9WEVGEMMV1B';
const secondTaskId = '01BX5ZZKBKACTAV9WEVGEMMV1C';
const firstLabelId = '01BX5ZZKBKACTAV9WEVGEMMV1D';
const secondLabelId = '01BX5ZZKBKACTAV9WEVGEMMV1E';
const createdAt = new Date('2026-08-01T00:00:00.000Z');

const table = {
  head: getTableName(invocationHead),
  milestone: getTableName(milestone),
  definition: getTableName(processDefinition),
  dependency: getTableName(processDependency),
  milestoneSpec: getTableName(processMilestoneSpec),
  projectSpec: getTableName(processProjectSpec),
  revision: getTableName(processRevision),
  step: getTableName(processStep),
  project: getTableName(project),
  projectLabel: getTableName(projectLabel),
  task: getTableName(task),
  taskDependency: getTableName(taskDependency),
  taskLabel: getTableName(taskLabel),
  team: getTableName(team),
} as const;

const openTeam = { id: teamId, workflowStates: [{ key: 'todo', type: 'unstarted' }] };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.enforced.mockResolvedValue(false);
  mocks.canonicalDetail.mockResolvedValue(null);
});

describe('private publication delegation', () => {
  const definition = ProcessDefinitionCreate.parse({
    name: 'Launch',
    creationMode: 'all_at_once',
    milestones: [],
    dependencies: [],
    tasks: [{ key: 'step', title: 'Step', teamId, labelIds: [], timing: { kind: 'on_trigger' } }],
  });

  it('creates enforced definitions through the private publication path', async () => {
    const published = { definitionId, revisionId, revisionNumber: 1, stepIdsByKey: {} };
    mocks.enforced.mockResolvedValue(true);
    mocks.createPrivate.mockResolvedValue(published);
    const fake = queryFake([]);
    await expect(
      createPublishedProcessDefinition(fake.database, { organizationId, actorId, definition }),
    ).resolves.toBe(published);
    expect(mocks.createPrivate).toHaveBeenCalledWith(fake.database, {
      organizationId,
      actorId,
      definition,
    });
    expect(fake.queries).toHaveLength(0);
  });

  it('refuses enforced creation without a foreground actor', async () => {
    mocks.enforced.mockResolvedValue(true);
    const fake = queryFake([]);
    await expect(
      createPublishedProcessDefinition(fake.database, { organizationId, definition }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.createPrivate).not.toHaveBeenCalled();
  });

  it('appends enforced revisions through the private publication path', async () => {
    const published = { definitionId, revisionId, revisionNumber: 2, stepIdsByKey: {} };
    mocks.enforced.mockResolvedValue(true);
    mocks.appendPrivate.mockResolvedValue(published);
    const fake = queryFake([]);
    await expect(
      appendPublishedProcessRevision(fake.database, {
        organizationId,
        actorId,
        definitionId,
        revision: definition,
      }),
    ).resolves.toBe(published);
    expect(mocks.appendPrivate).toHaveBeenCalledWith(fake.database, {
      organizationId,
      actorId,
      definitionId,
      definition,
    });
    expect(mocks.definitionAccess).not.toHaveBeenCalled();
  });
});

describe('appendPublishedProcessRevision', () => {
  const revision = ProcessDefinitionCreate.parse({
    name: 'Launch',
    creationMode: 'all_at_once',
    milestones: [],
    dependencies: [],
    tasks: [{ key: 'step', title: 'Step', teamId, labelIds: [], timing: { kind: 'on_trigger' } }],
  });

  it('refuses a definition that does not exist', async () => {
    const fake = routedQueryFake({ [table.definition]: [] });
    await expect(
      appendPublishedProcessRevision(fake.database, {
        organizationId,
        actorId,
        definitionId,
        revision,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.definitionAccess).toHaveBeenCalledOnce();
  });

  it('refuses a registered head that was archived while the definition stayed published', async () => {
    const fake = routedQueryFake({
      [table.definition]: [{ id: definitionId, status: 'published' }],
      [table.team]: [openTeam],
      [table.revision]: [],
      [table.head]: [{ canonicalAuthoringAt: createdAt, archivedAt: null, status: 'archived' }],
    });
    await expect(
      appendPublishedProcessRevision(fake.database, {
        organizationId,
        actorId,
        definitionId,
        revision,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(fake.queries.filter((query) => query.operation !== 'select')).toHaveLength(0);
  });
});

describe('createProcessDefinitionFromProjectInTransaction', () => {
  const command = {
    organizationId,
    actorId,
    input: ProcessDefinitionFromProjectCreate.parse({ projectId, creationMode: 'when_ready' }),
    now: new Date('2026-09-01T00:00:00.000Z'),
  };

  it('refuses a project that is missing or archived', async () => {
    const fake = routedQueryFake({ [table.project]: [] });
    await expect(
      createProcessDefinitionFromProjectInTransaction(fake.transaction, command),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('snapshots assignments, hierarchy, labels, and dependencies for a private publication', async () => {
    const captured = { definitionId, revisionId, revisionNumber: 1, stepIdsByKey: {} };
    mocks.enforced.mockResolvedValue(true);
    mocks.createPrivateInTransaction.mockResolvedValue(captured);
    const sourceProject = {
      id: projectId,
      name: 'Launch',
      summary: null,
      description: null,
      leadId,
      teamId,
      programId,
      startDate: null,
      targetDate: new Date('2026-08-20T00:00:00.000Z'),
    };
    const sourceTask = {
      description: null,
      teamId,
      priority: 2,
      estimate: null,
      estimateMinutes: null,
      startDate: null,
      dueDate: null,
    };
    const fake = routedQueryFake({
      [table.project]: [sourceProject],
      [table.milestone]: [
        {
          id: milestoneId,
          name: 'Beta',
          description: 'Beta cut',
          sort: 1,
          targetDate: new Date('2026-08-15T00:00:00.000Z'),
        },
      ],
      [table.task]: [
        {
          ...sourceTask,
          id: firstTaskId,
          title: 'Plan',
          assigneeId: actorId,
          milestoneId,
          parentTaskId: null,
          dueDate: new Date('2026-08-12T00:00:00.000Z'),
        },
        {
          ...sourceTask,
          id: secondTaskId,
          title: 'Build',
          assigneeId: null,
          milestoneId: null,
          parentTaskId: firstTaskId,
        },
      ],
      [table.projectLabel]: [{ labelId: firstLabelId }],
      [table.taskLabel]: [
        { taskId: firstTaskId, labelId: firstLabelId },
        { taskId: firstTaskId, labelId: secondLabelId },
      ],
      [table.taskDependency]: [{ blockingTaskId: firstTaskId, blockedTaskId: secondTaskId }],
    });
    await expect(
      createProcessDefinitionFromProjectInTransaction(fake.transaction, command),
    ).resolves.toBe(captured);
    const [, input] = mocks.createPrivateInTransaction.mock.calls[0] as [
      unknown,
      { readonly definition: Record<string, unknown> },
    ];
    expect(input.definition).toMatchObject({
      name: 'Launch series',
      creationMode: 'when_ready',
      project: {
        leadId,
        teamId,
        programId,
        labelIds: [firstLabelId],
        targetOffsetDays: 8,
      },
      milestones: [{ key: 'milestone-1', targetOffsetDays: 3 }],
      tasks: [
        {
          key: 'task-1',
          assigneeId: actorId,
          milestoneKey: 'milestone-1',
          parentTaskKey: undefined,
          dueOffsetDays: 0,
          labelIds: [firstLabelId, secondLabelId],
        },
        {
          key: 'task-2',
          assigneeId: undefined,
          milestoneKey: undefined,
          parentTaskKey: 'task-1',
          labelIds: [],
        },
      ],
      dependencies: [{ blockingStepKey: 'task-1', blockedStepKey: 'task-2' }],
    });
  });
});

describe('loadProcessDefinitionDetail', () => {
  const definitionRow = {
    id: definitionId,
    organizationId,
    name: 'Launch',
    description: null,
    status: 'published',
    createdAt,
    updatedAt: createdAt,
  };
  const revisionRow = {
    id: revisionId,
    number: 1,
    creationMode: 'all_at_once',
    publishedAt: null,
    createdAt,
  };
  const step = (id: string, key: string, sort: number): Record<string, unknown> => ({
    id,
    key,
    sort,
    timingKind: 'on_trigger',
    offsetDays: null,
    afterStepId: null,
    createdAt,
  });
  const projectSpec = {
    stepId: projectId,
    name: 'Launch',
    summary: null,
    description: null,
    leadId: null,
    teamId: null,
    programId: null,
    status: 'planned',
    health: null,
    startOffsetDays: null,
    targetOffsetDays: null,
  };

  it('prefers the canonical definition detail when one exists', async () => {
    const canonical = { id: definitionId };
    mocks.canonicalDetail.mockResolvedValue(canonical);
    const fake = queryFake([]);
    await expect(
      loadProcessDefinitionDetail(fake.database, organizationId, definitionId, actorId),
    ).resolves.toBe(canonical);
    expect(fake.queries).toHaveLength(0);
  });

  it('refuses a definition without a published revision', async () => {
    const fake = routedQueryFake({ [table.definition]: [definitionRow], [table.revision]: [] });
    await expect(
      loadProcessDefinitionDetail(fake.database, organizationId, definitionId, actorId),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('reconstructs an empty unpublished revision without specification reads', async () => {
    const fake = routedQueryFake({
      [table.definition]: [definitionRow],
      [table.revision]: [revisionRow],
      [table.step]: [],
    });
    const detail = await loadProcessDefinitionDetail(
      fake.database,
      organizationId,
      definitionId,
      actorId,
    );
    expect(detail.revision).toMatchObject({
      publishedAt: null,
      milestones: [],
      tasks: [],
      dependencies: [],
    });
    expect(detail.revision.project).toBeUndefined();
    expect(fake.queries).toHaveLength(3);
  });

  it('reconstructs sparse milestones under the project step', async () => {
    const fake = routedQueryFake({
      [table.definition]: [definitionRow],
      [table.revision]: [revisionRow],
      [table.step]: [
        step(projectId, 'project', 0),
        step(milestoneId, 'beta', 1),
        step(otherProjectId, 'launch', 2),
      ],
      [table.projectSpec]: [projectSpec],
      [table.milestoneSpec]: [
        {
          stepId: milestoneId,
          projectStepId: projectId,
          name: 'Beta',
          description: null,
          targetOffsetDays: 3,
        },
        {
          stepId: otherProjectId,
          projectStepId: projectId,
          name: 'Launch day',
          description: 'Ship it',
          targetOffsetDays: null,
        },
      ],
    });
    const detail = await loadProcessDefinitionDetail(
      fake.database,
      organizationId,
      definitionId,
      actorId,
    );
    expect(detail.revision.project).toMatchObject({ key: 'project', labelIds: [] });
    expect(detail.revision.milestones).toEqual([
      {
        key: 'beta',
        projectKey: 'project',
        name: 'Beta',
        sort: 1,
        targetOffsetDays: 3,
        timing: { kind: 'on_trigger' },
      },
      {
        key: 'launch',
        projectKey: 'project',
        name: 'Launch day',
        description: 'Ship it',
        sort: 2,
        timing: { kind: 'on_trigger' },
      },
    ]);
  });

  it('refuses a milestone whose project step is missing', async () => {
    const fake = routedQueryFake({
      [table.definition]: [definitionRow],
      [table.revision]: [revisionRow],
      [table.step]: [step(milestoneId, 'beta', 1)],
      [table.milestoneSpec]: [
        {
          stepId: milestoneId,
          projectStepId: projectId,
          name: 'Beta',
          description: null,
          targetOffsetDays: null,
        },
      ],
    });
    await expect(
      loadProcessDefinitionDetail(fake.database, organizationId, definitionId, actorId),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a dependency whose step is missing', async () => {
    const fake = routedQueryFake({
      [table.definition]: [definitionRow],
      [table.revision]: [revisionRow],
      [table.step]: [step(projectId, 'project', 0)],
      [table.dependency]: [{ blockingStepId: projectId, blockedStepId: milestoneId }],
    });
    await expect(
      loadProcessDefinitionDetail(fake.database, organizationId, definitionId, actorId),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
