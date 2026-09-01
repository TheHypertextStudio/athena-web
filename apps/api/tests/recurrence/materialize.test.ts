/**
 * `@docket/api` — persisted process authoring, materialization, and completion advancement.
 */
import { resolve } from 'node:path';

import {
  actor,
  cycle,
  fullSchema,
  label,
  milestone,
  organization,
  processDefinition,
  processInstance,
  processInstanceTask,
  processOccurrence,
  processRevision,
  processStep,
  program,
  project,
  projectLabel,
  recurrenceSeries,
  recurrenceSeriesRevision,
  task,
  taskDependency,
  taskLabel,
  team,
  type Database,
} from '@docket/db';
import type * as DbModule from '@docket/db';
import { ActorId, TeamId } from '@docket/identity-access/ids';
import { CycleId, LabelId, MilestoneId, ProgramId, ProjectId, TaskId } from '@docket/work/ids';
import { type ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  appendPublishedProcessRevision,
  archiveProcessDefinition,
  createPublishedProcessDefinition,
  createProcessDefinitionFromProject,
  loadProcessDefinitionDetail,
  updateProcessDefinitionMetadata,
  validateProcessDefinitionGraph,
} from '../../src/lib/recurrence/process-definition';
import { materializeOccurrence } from '../../src/lib/recurrence/materialize';
import { advanceCompletedProcessTask } from '../../src/lib/recurrence/advance';
import { loadGeneratedWorkRecurrence } from '../../src/lib/recurrence/series';
import { seedStatuses, type StatusIdLookup } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let client!: PGlite;
let dbmod!: typeof DbModule;
let db!: Database;
let organizationId!: string;
type TeamIdBrand = ReturnType<typeof TeamId.parse>;
type LabelIdBrand = ReturnType<typeof LabelId.parse>;

let teamId!: TeamIdBrand;
let actorId!: string;
/** The workspace's status ids, for every row this file inserts with a status key of its own. */
let statusId!: StatusIdLookup;
let promotionLabelId!: LabelIdBrand;
let reportingLabelId!: LabelIdBrand;

/** A representative fixed project process with hierarchy, dates, labels, and dependencies. */
function bookClubDefinition(title = 'Create summary report'): ProcessDefinitionCreate {
  return {
    name: 'Book Club Season',
    description: 'One book and its event follow-up.',
    creationMode: 'all_at_once',
    project: {
      key: 'season',
      name: 'Book Club · {date}',
      summary: 'Read and discuss one urbanism book.',
      teamId,
      status: 'planned',
      startOffsetDays: -7,
      targetOffsetDays: 45,
      labelIds: [promotionLabelId],
      timing: { kind: 'on_trigger' },
    },
    milestones: [
      {
        key: 'event',
        projectKey: 'season',
        name: 'Book club event',
        sort: 1,
        targetOffsetDays: 32,
        timing: { kind: 'relative_to_trigger', offsetDays: 30 },
      },
    ],
    tasks: [
      {
        key: 'announce',
        title: 'Announce this month’s book',
        teamId,
        projectKey: 'season',
        priority: 'medium',
        estimateMinutes: 30,
        labelIds: [promotionLabelId],
        timing: { kind: 'relative_to_trigger', offsetDays: -14 },
      },
      {
        key: 'story',
        title: 'Make story post for book club',
        teamId,
        projectKey: 'season',
        parentTaskKey: 'announce',
        state: 'todo',
        priority: 'low',
        estimate: 2,
        labelIds: [promotionLabelId],
        timing: { kind: 'on_trigger' },
      },
      {
        key: 'report',
        title,
        teamId,
        projectKey: 'season',
        milestoneKey: 'event',
        priority: 'none',
        labelIds: [reportingLabelId],
        timing: { kind: 'relative_to_trigger', offsetDays: 31 },
      },
    ],
    dependencies: [{ blockingStepKey: 'story', blockedStepKey: 'report' }],
  };
}

/** Create a calendar series over a published definition revision. */
async function calendarSeries(
  definitionId: string,
  revisionId: string,
  startDate = '2026-09-01',
): Promise<{ seriesId: string; seriesRevisionId: string }> {
  const series = assertDefined(
    (
      await db
        .insert(recurrenceSeries)
        .values({
          organizationId,
          definitionId,
          name: 'Book Club Season',
          createdBy: actorId,
        })
        .returning()
    )[0],
  );
  const revision = assertDefined(
    (
      await db
        .insert(recurrenceSeriesRevision)
        .values({
          organizationId,
          seriesId: series.id,
          processRevisionId: revisionId,
          number: 1,
          effectiveFrom: startDate,
          triggerKind: 'calendar',
          scheduleKind: 'monthly',
          interval: 2,
          startDate,
          timezone: 'America/Los_Angeles',
          endKind: 'never',
          monthlyPatternKind: 'day_of_month',
          monthDay: 1,
          overflow: 'skip',
          missedPolicy: 'resolve',
          horizonDays: 28,
          minimumOccurrences: 2,
          createdBy: actorId,
        })
        .returning()
    )[0],
  );
  return { seriesId: series.id, seriesRevisionId: revision.id };
}

describe('process materialization', () => {
  beforeAll(async () => {
    client = new PGlite('memory://');
    const migrated = drizzle(client, { schema: fullSchema });
    await migrate(migrated, { migrationsFolder: MIGRATIONS });
    db = migrated;
    dbmod = await import('@docket/db');
    organizationId = assertDefined(
      (
        await db
          .insert(organization)
          .values({ name: 'Repeating work tests', slug: `repeat-api-${Date.now()}` })
          .returning()
      )[0],
    ).id;
    // Statuses come before any work: every Task, Project, and Program below stores both its
    // status key and the id of the workspace status carrying it.
    statusId = await seedStatuses(db, dbmod, organizationId);
    teamId = TeamId.parse(
      await db
        .insert(team)
        .values({ organizationId, name: 'Community Programs', key: 'COMMUNITY' })
        .returning()
        .then((rows) => assertDefined(rows[0]).id),
    );
    actorId = assertDefined(
      (
        await db
          .insert(actor)
          .values({ organizationId, kind: 'agent', displayName: 'Test coordinator' })
          .returning()
      )[0],
    ).id;
    const labels = await db
      .insert(label)
      .values([
        { organizationId, name: 'Promotion', color: 'blue' },
        { organizationId, name: 'Reporting', color: 'green' },
      ])
      .returning();
    promotionLabelId = LabelId.parse(assertDefined(labels[0]).id);
    reportingLabelId = LabelId.parse(assertDefined(labels[1]).id);
  });

  afterAll(async () => {
    await client.close();
  });

  it('rejects cycles across dependencies and completion timing before writing', () => {
    const definition = bookClubDefinition();
    definition.tasks[0] = {
      ...assertDefined(definition.tasks[0]),
      timing: { kind: 'after_step_completion', stepKey: 'report', offsetDays: 0 },
    };
    expect(() => {
      validateProcessDefinitionGraph(definition);
    }).toThrow(/cycle/i);
  });

  it('authors a published immutable revision with normalized step rows', async () => {
    const authored = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition: bookClubDefinition(),
    });

    expect(authored.revisionNumber).toBe(1);
    expect(Object.keys(authored.stepIdsByKey).sort()).toEqual([
      'announce',
      'event',
      'report',
      'season',
      'story',
    ]);
    const [definitionRow] = await db
      .select()
      .from(processDefinition)
      .where(eq(processDefinition.id, authored.definitionId));
    const [revisionRow] = await db
      .select()
      .from(processRevision)
      .where(eq(processRevision.id, authored.revisionId));
    expect(definitionRow?.status).toBe('published');
    expect(revisionRow?.publishedAt).not.toBeNull();
    expect(
      await db.select().from(processStep).where(eq(processStep.revisionId, authored.revisionId)),
    ).toHaveLength(5);
  });

  it('reconstructs minimal and fully qualified process fields from normalized storage', async () => {
    const minimal = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition: {
        name: 'Daily recovery walk',
        creationMode: 'all_at_once',
        milestones: [],
        tasks: [
          {
            key: 'walk',
            title: 'Take a recovery walk',
            teamId,
            priority: 'none',
            labelIds: [],
            timing: { kind: 'on_trigger' },
          },
        ],
        dependencies: [],
      },
    });
    const minimalDetail = await loadProcessDefinitionDetail(
      db,
      organizationId,
      minimal.definitionId,
    );
    expect(minimalDetail.revision.project).toBeUndefined();
    expect(minimalDetail.revision.milestones).toEqual([]);
    expect(minimalDetail.revision.dependencies).toEqual([]);
    expect(minimalDetail.revision.tasks).toEqual([
      {
        key: 'walk',
        title: 'Take a recovery walk',
        teamId,
        priority: 'none',
        labelIds: [],
        timing: { kind: 'on_trigger' },
      },
    ]);

    const [owningProgram] = await db
      .insert(program)
      .values({
        organizationId,
        name: 'Urbanist Book Club Program',
        status: 'active',
        statusId: statusId('program', 'active'),
      })
      .returning();
    const qualified = bookClubDefinition();
    qualified.project = {
      ...assertDefined(qualified.project),
      description: 'A complete reusable season for one book.',
      leadId: ActorId.parse(actorId),
      programId: ProgramId.parse(assertDefined(owningProgram).id),
      health: 'on_track',
    };
    qualified.tasks[0] = {
      ...assertDefined(qualified.tasks[0]),
      description: 'Publish the announcement with the registration link.',
      state: 'todo',
      assigneeId: ActorId.parse(actorId),
      estimate: 3,
      startOffsetDays: -16,
      dueOffsetDays: -14,
    };
    const full = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition: qualified,
    });
    const fullDetail = await loadProcessDefinitionDetail(db, organizationId, full.definitionId);
    expect(fullDetail.revision.project).toMatchObject({
      description: 'A complete reusable season for one book.',
      leadId: actorId,
      programId: assertDefined(owningProgram).id,
      health: 'on_track',
    });
    expect(fullDetail.revision.tasks[0]).toMatchObject({
      description: 'Publish the announcement with the registration link.',
      state: 'todo',
      assigneeId: actorId,
      estimate: 3,
      estimateMinutes: 30,
      startOffsetDays: -16,
      dueOffsetDays: -14,
    });
  });

  it('snapshots an existing project into a reusable relative process', async () => {
    const [sourceProject] = await db
      .insert(project)
      .values({
        organizationId,
        name: 'Intro to Urbanism Workshop',
        teamId,
        status: 'active',
        statusId: statusId('project', 'active'),
        startDate: new Date('2026-09-10T00:00:00.000Z'),
        targetDate: new Date('2026-09-20T00:00:00.000Z'),
      })
      .returning();
    const [sourceMilestone] = await db
      .insert(milestone)
      .values({
        organizationId,
        projectId: assertDefined(sourceProject).id,
        name: 'Workshop day',
        targetDate: new Date('2026-09-18T00:00:00.000Z'),
      })
      .returning();
    const sourceTasks = await db
      .insert(task)
      .values([
        {
          organizationId,
          projectId: assertDefined(sourceProject).id,
          milestoneId: assertDefined(sourceMilestone).id,
          teamId,
          title: 'Publish the event',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
          priority: 'medium',
          dueDate: new Date('2026-09-12T00:00:00.000Z'),
        },
        {
          organizationId,
          projectId: assertDefined(sourceProject).id,
          teamId,
          title: 'Send attendee follow-ups',
          state: 'done',
          statusId: statusId('task', 'done'),
          priority: 'none',
          dueDate: new Date('2026-09-19T00:00:00.000Z'),
        },
      ])
      .returning();
    await db.insert(taskDependency).values({
      organizationId,
      blockingTaskId: assertDefined(sourceTasks[0]).id,
      blockedTaskId: assertDefined(sourceTasks[1]).id,
    });

    const created = await createProcessDefinitionFromProject(db, {
      organizationId,
      actorId,
      input: {
        projectId: ProjectId.parse(assertDefined(sourceProject).id),
        creationMode: 'all_at_once',
      },
    });
    const detail = await loadProcessDefinitionDetail(db, organizationId, created.definitionId);

    expect(detail.name).toBe('Intro to Urbanism Workshop series');
    expect(detail.revision.project).toMatchObject({ startOffsetDays: 0, targetOffsetDays: 10 });
    expect(detail.revision.milestones[0]).toMatchObject({ targetOffsetDays: 8 });
    expect(detail.revision.tasks.map((value) => value.dueOffsetDays)).toEqual([2, 9]);
    expect(detail.revision.tasks.every((value) => value.state === undefined)).toBe(true);
    expect(detail.revision.dependencies).toEqual([
      { blockingStepKey: 'task-1', blockedStepKey: 'task-2' },
    ]);
  });

  it('snapshots an undated minimal project from the supplied planning date', async () => {
    const [sourceProject] = await db
      .insert(project)
      .values({
        organizationId,
        name: 'Transit meetup',
        status: 'planned',
        statusId: statusId('project', 'planned'),
      })
      .returning();
    await db.insert(task).values({
      organizationId,
      teamId,
      projectId: assertDefined(sourceProject).id,
      title: 'Host meetup',
      state: 'backlog',
      statusId: statusId('task', 'backlog'),
    });

    const created = await createProcessDefinitionFromProject(db, {
      organizationId,
      actorId,
      now: new Date('2026-10-15T18:00:00.000Z'),
      input: {
        projectId: ProjectId.parse(assertDefined(sourceProject).id),
        name: 'Transit meetup process',
        creationMode: 'all_at_once',
      },
    });
    const detail = await loadProcessDefinitionDetail(db, organizationId, created.definitionId);

    expect(detail.name).toBe('Transit meetup process');
    expect(detail.description).toBeNull();
    expect(detail.revision.project).toEqual({
      key: 'project',
      name: 'Transit meetup · {date}',
      status: 'planned',
      startOffsetDays: 0,
      labelIds: [],
      timing: { kind: 'on_trigger' },
    });
    expect(detail.revision.tasks).toEqual([
      {
        key: 'task-1',
        title: 'Host meetup',
        teamId,
        priority: 'none',
        projectKey: 'project',
        labelIds: [],
        timing: { kind: 'on_trigger' },
      },
    ]);
  });

  it('rejects a missing project or a project without tasks as a reusable process', async () => {
    await expect(
      createProcessDefinitionFromProject(db, {
        organizationId,
        actorId,
        input: {
          projectId: ProjectId.parse('01J00000000000000000000000'),
          creationMode: 'all_at_once',
        },
      }),
    ).rejects.toThrow(/project not found/i);

    const [emptyProject] = await db
      .insert(project)
      .values({
        organizationId,
        name: 'Empty workshop',
        status: 'planned',
        statusId: statusId('project', 'planned'),
      })
      .returning();
    await expect(
      createProcessDefinitionFromProject(db, {
        organizationId,
        actorId,
        input: {
          projectId: ProjectId.parse(assertDefined(emptyProject).id),
          creationMode: 'all_at_once',
        },
      }),
    ).rejects.toThrow(/at least one task/i);
  });

  it('rejects invalid states and team-scoped labels before publishing generated work', async () => {
    const invalidState = bookClubDefinition();
    invalidState.tasks[0] = {
      ...assertDefined(invalidState.tasks[0]),
      state: 'not-a-workflow-state',
    };
    await expect(
      createPublishedProcessDefinition(db, { organizationId, actorId, definition: invalidState }),
    ).rejects.toThrow(/state.*not available/i);

    const terminalState = bookClubDefinition();
    terminalState.tasks[0] = { ...assertDefined(terminalState.tasks[0]), state: 'done' };
    await expect(
      createPublishedProcessDefinition(db, { organizationId, actorId, definition: terminalState }),
    ).rejects.toThrow(/non-terminal/i);

    const [otherTeam] = await db
      .insert(team)
      .values({ organizationId, name: 'Other team', key: `OTHER-${Date.now()}` })
      .returning();
    const [otherTeamLabel] = await db
      .insert(label)
      .values({
        organizationId,
        teamId: assertDefined(otherTeam).id,
        name: 'Other team only',
        color: 'gray',
      })
      .returning();
    const invalidTaskLabel = bookClubDefinition();
    invalidTaskLabel.tasks[0] = {
      ...assertDefined(invalidTaskLabel.tasks[0]),
      labelIds: [LabelId.parse(assertDefined(otherTeamLabel).id)],
    };
    await expect(
      createPublishedProcessDefinition(db, {
        organizationId,
        actorId,
        definition: invalidTaskLabel,
      }),
    ).rejects.toThrow(/task label/i);

    const invalidProjectLabel = bookClubDefinition();
    invalidProjectLabel.project = {
      ...assertDefined(invalidProjectLabel.project),
      labelIds: [LabelId.parse(assertDefined(otherTeamLabel).id)],
    };
    await expect(
      createPublishedProcessDefinition(db, {
        organizationId,
        actorId,
        definition: invalidProjectLabel,
      }),
    ).rejects.toThrow(/project label/i);
  });

  it('updates mutable metadata and refuses to revise an archived process', async () => {
    const authored = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition: bookClubDefinition(),
    });
    const updated = await updateProcessDefinitionMetadata(db, {
      organizationId,
      definitionId: authored.definitionId,
      patch: { description: 'A revised explanation without changing execution.' },
    });
    expect(updated.name).toBe('Book Club Season');
    expect(updated.description).toBe('A revised explanation without changing execution.');

    await archiveProcessDefinition(db, organizationId, authored.definitionId);
    await expect(
      appendPublishedProcessRevision(db, {
        organizationId,
        actorId,
        definitionId: authored.definitionId,
        revision: bookClubDefinition('A revision that must not publish'),
      }),
    ).rejects.toThrow(/archived.*cannot change/i);
    await expect(
      updateProcessDefinitionMetadata(db, {
        organizationId,
        definitionId: authored.definitionId,
        patch: { name: 'Hidden update' },
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('materializes a fixed plan atomically and returns the same entities on retry', async () => {
    const authored = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition: bookClubDefinition(),
    });
    const series = await calendarSeries(authored.definitionId, authored.revisionId);

    const [first, concurrent] = await Promise.all([
      materializeOccurrence(db, {
        organizationId,
        actorId,
        ...series,
        scheduledFor: '2026-09-01',
      }),
      materializeOccurrence(db, {
        organizationId,
        actorId,
        ...series,
        scheduledFor: '2026-09-01',
      }),
    ]);
    const retried = await materializeOccurrence(db, {
      organizationId,
      actorId,
      ...series,
      scheduledFor: '2026-09-01',
    });

    expect(concurrent).toEqual(first);
    expect(retried).toEqual(first);
    expect(Object.keys(first.projectIdsByKey)).toEqual(['season']);
    expect(Object.keys(first.milestoneIdsByKey)).toEqual(['event']);
    expect(Object.keys(first.taskIdsByKey).sort()).toEqual(['announce', 'report', 'story']);

    const [createdProject] = await db
      .select()
      .from(project)
      .where(eq(project.id, assertDefined(first.projectIdsByKey['season'])));
    const [createdMilestone] = await db
      .select()
      .from(milestone)
      .where(eq(milestone.id, assertDefined(first.milestoneIdsByKey['event'])));
    const createdTasks = await db
      .select()
      .from(task)
      .where(eq(task.organizationId, organizationId));
    const announce = createdTasks.find((row) => row.id === first.taskIdsByKey['announce']);
    const story = createdTasks.find((row) => row.id === first.taskIdsByKey['story']);
    const report = createdTasks.find((row) => row.id === first.taskIdsByKey['report']);

    expect(createdProject?.startDate?.toISOString()).toBe('2026-08-25T00:00:00.000Z');
    expect(createdProject?.targetDate?.toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(createdMilestone?.targetDate?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(announce).toMatchObject({
      state: 'backlog',
      priority: 'medium',
      estimateMinutes: 30,
      projectId: createdProject?.id,
    });
    expect(announce?.dueDate?.toISOString()).toBe('2026-08-18T00:00:00.000Z');
    expect(story).toMatchObject({
      state: 'todo',
      estimate: 2,
      parentTaskId: announce?.id,
      projectId: createdProject?.id,
    });
    expect(report).toMatchObject({
      milestoneId: createdMilestone?.id,
      projectId: createdProject?.id,
    });
    expect(report?.dueDate?.toISOString()).toBe('2026-10-02T00:00:00.000Z');

    expect(
      await loadGeneratedWorkRecurrence(db, {
        kind: 'task',
        organizationId,
        taskId: assertDefined(report).id,
      }),
    ).toMatchObject({
      kind: 'task',
      seriesId: series.seriesId,
      scheduledFor: '2026-09-01',
    });
    expect(
      await loadGeneratedWorkRecurrence(db, {
        kind: 'project',
        organizationId,
        projectId: assertDefined(createdProject).id,
      }),
    ).toMatchObject({
      kind: 'project',
      seriesId: series.seriesId,
      scheduledFor: '2026-09-01',
    });

    expect(
      await db
        .select()
        .from(projectLabel)
        .where(eq(projectLabel.projectId, assertDefined(createdProject).id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(taskLabel)
        .where(eq(taskLabel.taskId, assertDefined(report).id)),
    ).toEqual([
      expect.objectContaining({ taskId: assertDefined(report).id, labelId: reportingLabelId }),
    ]);
    expect(
      await db
        .select()
        .from(taskDependency)
        .where(eq(taskDependency.blockingTaskId, assertDefined(story).id)),
    ).toEqual([
      expect.objectContaining({
        blockingTaskId: assertDefined(story).id,
        blockedTaskId: assertDefined(report).id,
      }),
    ]);
    expect(
      await db
        .select()
        .from(processInstance)
        .where(eq(processInstance.occurrenceId, first.occurrenceId)),
    ).toHaveLength(1);
  });

  it('preserves ordinary task references and explicit dates in a recurring task', async () => {
    const fixedProject = assertDefined(
      (
        await db
          .insert(project)
          .values({
            organizationId,
            name: 'Marathon training',
            teamId,
            status: 'planned',
            statusId: statusId('project', 'planned'),
          })
          .returning()
      )[0],
    );
    const fixedMilestone = assertDefined(
      (
        await db
          .insert(milestone)
          .values({ organizationId, projectId: fixedProject.id, name: 'Race day' })
          .returning()
      )[0],
    );
    const fixedCycle = assertDefined(
      (
        await db
          .insert(cycle)
          .values({
            organizationId,
            teamId,
            number: 1,
            name: 'Training block',
            startsAt: new Date('2026-09-01T00:00:00.000Z'),
            endsAt: new Date('2026-10-01T00:00:00.000Z'),
          })
          .returning()
      )[0],
    );
    const fixedParent = assertDefined(
      (
        await db
          .insert(task)
          .values({
            organizationId,
            teamId,
            title: 'Marathon plan',
            state: 'done',
            statusId: statusId('task', 'done'),
            completedAt: new Date('2026-09-01T00:00:00.000Z'),
            autoCompletedBySubtasks: true,
          })
          .returning()
      )[0],
    );
    const definition: ProcessDefinitionCreate = {
      name: 'Run six miles',
      creationMode: 'all_at_once',
      milestones: [],
      tasks: [
        {
          key: 'task',
          title: 'Run six miles',
          teamId,
          projectId: ProjectId.parse(fixedProject.id),
          milestoneId: MilestoneId.parse(fixedMilestone.id),
          cycleId: CycleId.parse(fixedCycle.id),
          parentTaskId: TaskId.parse(fixedParent.id),
          startOffsetDays: 1,
          dueOffsetDays: 2,
          priority: 'high',
          labelIds: [promotionLabelId],
          timing: { kind: 'on_trigger' },
        },
      ],
      dependencies: [],
    };
    const authored = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition,
    });
    const detail = await loadProcessDefinitionDetail(db, organizationId, authored.definitionId);
    expect(detail.revision.tasks[0]).toMatchObject({
      projectId: fixedProject.id,
      milestoneId: fixedMilestone.id,
      cycleId: fixedCycle.id,
      parentTaskId: fixedParent.id,
      startOffsetDays: 1,
      dueOffsetDays: 2,
    });
    const series = await calendarSeries(authored.definitionId, authored.revisionId, '2026-09-10');

    const materialized = await materializeOccurrence(db, {
      organizationId,
      actorId,
      ...series,
      scheduledFor: '2026-09-10',
    });
    const [created] = await db
      .select()
      .from(task)
      .where(eq(task.id, assertDefined(materialized.taskIdsByKey['task'])));

    expect(created).toMatchObject({
      projectId: fixedProject.id,
      milestoneId: fixedMilestone.id,
      cycleId: fixedCycle.id,
      parentTaskId: fixedParent.id,
      priority: 'high',
    });
    expect(created?.startDate?.toISOString()).toBe('2026-09-11T00:00:00.000Z');
    expect(created?.dueDate?.toISOString()).toBe('2026-09-12T00:00:00.000Z');
    const [reopenedParent] = await db
      .select({
        state: task.state,
        completedAt: task.completedAt,
        autoCompletedBySubtasks: task.autoCompletedBySubtasks,
      })
      .from(task)
      .where(eq(task.id, fixedParent.id));
    expect(reopenedParent).toEqual({
      state: 'backlog',
      completedAt: null,
      autoCompletedBySubtasks: false,
    });
    expect(
      await db
        .select()
        .from(taskLabel)
        .where(eq(taskLabel.taskId, assertDefined(created).id)),
    ).toEqual([expect.objectContaining({ labelId: promotionLabelId })]);
  });

  it('releases when-ready steps only after every prerequisite task completes', async () => {
    const definition = bookClubDefinition();
    definition.creationMode = 'when_ready';
    definition.tasks = [
      {
        key: 'interest-email',
        title: 'Send interest email',
        teamId,
        priority: 'none',
        labelIds: [],
        timing: { kind: 'on_trigger' },
      },
      {
        key: 'interview',
        title: 'Schedule interview',
        teamId,
        priority: 'none',
        labelIds: [],
        timing: {
          kind: 'after_step_completion',
          stepKey: 'interest-email',
          offsetDays: 2,
        },
      },
    ];
    definition.project = undefined;
    definition.milestones = [];
    definition.dependencies = [{ blockingStepKey: 'interest-email', blockedStepKey: 'interview' }];
    const authored = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition,
    });
    const series = await calendarSeries(authored.definitionId, authored.revisionId, '2026-09-05');
    const initial = await materializeOccurrence(db, {
      organizationId,
      actorId,
      ...series,
      scheduledFor: '2026-09-05',
    });
    expect(Object.keys(initial.taskIdsByKey)).toEqual(['interest-email']);

    const rootTaskId = assertDefined(initial.taskIdsByKey['interest-email']);
    await db
      .update(task)
      .set({
        state: 'done',
        statusId: statusId('task', 'done'),
        completedAt: new Date('2026-09-08T20:00:00.000Z'),
      })
      .where(eq(task.id, rootTaskId));
    const advanced = await advanceCompletedProcessTask(db, {
      organizationId,
      actorId,
      completedTaskId: rootTaskId,
      completedOn: '2026-09-08',
    });
    const retried = await advanceCompletedProcessTask(db, {
      organizationId,
      actorId,
      completedTaskId: rootTaskId,
      completedOn: '2026-09-08',
    });

    expect(advanced.createdTaskIdsByKey).toHaveProperty('interview');
    expect(retried.createdTaskIdsByKey).toEqual({});
    const [interview] = await db
      .select()
      .from(task)
      .where(eq(task.id, assertDefined(advanced.createdTaskIdsByKey['interview'])));
    expect(interview?.dueDate?.toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(
      await db
        .select()
        .from(processInstanceTask)
        .where(eq(processInstanceTask.instanceId, initial.instanceId)),
    ).toHaveLength(2);
  });

  it('dates all-at-once project, milestone, and task work from actual prerequisite completion', async () => {
    const definition: ProcessDefinitionCreate = {
      name: 'Coordinator onboarding',
      creationMode: 'all_at_once',
      project: {
        key: 'onboarding',
        name: 'Coordinator onboarding · {date}',
        status: 'planned',
        labelIds: [],
        timing: { kind: 'after_step_completion', stepKey: 'interest-email', offsetDays: 2 },
      },
      milestones: [
        {
          key: 'orientation',
          projectKey: 'onboarding',
          name: 'Orientation complete',
          sort: 1,
          timing: { kind: 'after_step_completion', stepKey: 'interest-email', offsetDays: 3 },
        },
      ],
      tasks: [
        {
          key: 'interest-email',
          title: 'Send interest email',
          teamId,
          priority: 'none',
          labelIds: [],
          timing: { kind: 'on_trigger' },
        },
        {
          key: 'follow-up',
          title: 'Send follow-up materials',
          teamId,
          projectKey: 'onboarding',
          milestoneKey: 'orientation',
          priority: 'none',
          labelIds: [],
          timing: { kind: 'after_step_completion', stepKey: 'interest-email', offsetDays: 4 },
        },
      ],
      dependencies: [{ blockingStepKey: 'interest-email', blockedStepKey: 'follow-up' }],
    };
    const authored = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition,
    });
    const series = await calendarSeries(authored.definitionId, authored.revisionId, '2026-11-01');
    const initial = await materializeOccurrence(db, {
      organizationId,
      actorId,
      ...series,
      scheduledFor: '2026-11-01',
    });
    const rootTaskId = assertDefined(initial.taskIdsByKey['interest-email']);
    await db
      .update(task)
      .set({
        state: 'done',
        statusId: statusId('task', 'done'),
        completedAt: new Date('2026-11-05T20:00:00.000Z'),
      })
      .where(eq(task.id, rootTaskId));

    const advanced = await advanceCompletedProcessTask(db, {
      organizationId,
      actorId,
      completedTaskId: rootTaskId,
      completedOn: '2026-11-05',
    });
    expect(advanced.instanceCompleted).toBe(false);
    expect(advanced.createdProjectIdsByKey).toEqual({});
    expect(advanced.createdMilestoneIdsByKey).toEqual({});
    expect(advanced.createdTaskIdsByKey).toEqual({});

    const [datedProject] = await db
      .select()
      .from(project)
      .where(eq(project.id, assertDefined(initial.projectIdsByKey['onboarding'])));
    const [datedMilestone] = await db
      .select()
      .from(milestone)
      .where(eq(milestone.id, assertDefined(initial.milestoneIdsByKey['orientation'])));
    const [datedFollowUp] = await db
      .select()
      .from(task)
      .where(eq(task.id, assertDefined(initial.taskIdsByKey['follow-up'])));
    expect(datedProject?.startDate?.toISOString()).toBe('2026-11-07T00:00:00.000Z');
    expect(datedMilestone?.targetDate?.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(datedFollowUp?.dueDate?.toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });

  it('ignores ordinary tasks and generated tasks that have not actually completed', async () => {
    const [ordinaryTask] = await db
      .insert(task)
      .values({
        organizationId,
        teamId,
        title: 'Ordinary task',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      })
      .returning();
    expect(
      await advanceCompletedProcessTask(db, {
        organizationId,
        actorId,
        completedTaskId: assertDefined(ordinaryTask).id,
        completedOn: '2026-11-01',
      }),
    ).toEqual({
      createdProjectIdsByKey: {},
      createdMilestoneIdsByKey: {},
      createdTaskIdsByKey: {},
      instanceCompleted: false,
      nextOccurrenceId: null,
    });

    const authored = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition: {
        name: 'Unfinished check-in',
        creationMode: 'all_at_once',
        milestones: [],
        tasks: [
          {
            key: 'check-in',
            title: 'Conduct check-in',
            teamId,
            priority: 'none',
            labelIds: [],
            timing: { kind: 'on_trigger' },
          },
        ],
        dependencies: [],
      },
    });
    const series = await calendarSeries(authored.definitionId, authored.revisionId, '2026-11-02');
    const generated = await materializeOccurrence(db, {
      organizationId,
      actorId,
      ...series,
      scheduledFor: '2026-11-02',
    });
    expect(
      await advanceCompletedProcessTask(db, {
        organizationId,
        actorId,
        completedTaskId: assertDefined(generated.taskIdsByKey['check-in']),
        completedOn: '2026-11-02',
      }),
    ).toMatchObject({ instanceCompleted: false, nextOccurrenceId: null });
  });

  it('keeps old instances on their revision when a future revision is published', async () => {
    const authored = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition: bookClubDefinition('Original report'),
    });
    const firstSeries = await calendarSeries(authored.definitionId, authored.revisionId);
    const first = await materializeOccurrence(db, {
      organizationId,
      actorId,
      ...firstSeries,
      scheduledFor: '2026-09-01',
    });

    const next = await appendPublishedProcessRevision(db, {
      organizationId,
      actorId,
      definitionId: authored.definitionId,
      revision: bookClubDefinition('Revised report'),
    });
    const nextSeries = await calendarSeries(authored.definitionId, next.revisionId, '2026-11-01');
    const second = await materializeOccurrence(db, {
      organizationId,
      actorId,
      ...nextSeries,
      scheduledFor: '2026-11-01',
    });

    const [originalTask] = await db
      .select()
      .from(task)
      .where(eq(task.id, assertDefined(first.taskIdsByKey['report'])));
    const [revisedTask] = await db
      .select()
      .from(task)
      .where(eq(task.id, assertDefined(second.taskIdsByKey['report'])));
    expect(originalTask?.title).toBe('Original report');
    expect(revisedTask?.title).toBe('Revised report');
    expect(next.revisionNumber).toBe(2);
  });

  it('anchors the next completion series occurrence to actual completion exactly once', async () => {
    const definition: ProcessDefinitionCreate = {
      name: 'Coordinator check-in',
      creationMode: 'all_at_once',
      milestones: [],
      tasks: [
        {
          key: 'check-in',
          title: 'Conduct check-in',
          teamId,
          priority: 'none',
          labelIds: [],
          timing: { kind: 'on_trigger' },
        },
      ],
      dependencies: [],
    };
    const authored = await createPublishedProcessDefinition(db, {
      organizationId,
      actorId,
      definition,
    });
    const series = assertDefined(
      (
        await db
          .insert(recurrenceSeries)
          .values({
            organizationId,
            definitionId: authored.definitionId,
            name: definition.name,
            createdBy: actorId,
          })
          .returning()
      )[0],
    );
    const seriesRevision = assertDefined(
      (
        await db
          .insert(recurrenceSeriesRevision)
          .values({
            organizationId,
            seriesId: series.id,
            processRevisionId: authored.revisionId,
            number: 1,
            effectiveFrom: '2026-09-01',
            triggerKind: 'after_completion',
            interval: 1,
            intervalUnit: 'month',
            createdBy: actorId,
          })
          .returning()
      )[0],
    );
    const first = await materializeOccurrence(db, {
      organizationId,
      actorId,
      seriesId: series.id,
      seriesRevisionId: seriesRevision.id,
      scheduledFor: '2026-09-01',
    });
    const taskId = assertDefined(first.taskIdsByKey['check-in']);
    await db
      .update(task)
      .set({
        state: 'done',
        statusId: statusId('task', 'done'),
        completedAt: new Date('2026-09-30T23:30:00.000Z'),
      })
      .where(eq(task.id, taskId));

    const advanced = await advanceCompletedProcessTask(db, {
      organizationId,
      actorId,
      completedTaskId: taskId,
      completedOn: '2026-09-30',
    });
    await advanceCompletedProcessTask(db, {
      organizationId,
      actorId,
      completedTaskId: taskId,
      completedOn: '2026-09-30',
    });

    expect(advanced.nextOccurrenceId).not.toBeNull();
    expect(
      await db.select().from(processOccurrence).where(eq(processOccurrence.seriesId, series.id)),
    ).toEqual([
      expect.objectContaining({ scheduledFor: '2026-09-01', status: 'completed' }),
      expect.objectContaining({ scheduledFor: '2026-10-30', status: 'materialized' }),
    ]);
    expect(
      await db
        .select()
        .from(processInstanceTask)
        .innerJoin(processInstance, eq(processInstance.id, processInstanceTask.instanceId))
        .where(
          and(
            eq(processInstance.organizationId, organizationId),
            eq(processInstance.revisionId, authored.revisionId),
          ),
        ),
    ).toHaveLength(2);
  });
});
