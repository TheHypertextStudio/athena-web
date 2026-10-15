import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { getDb, one, seedTask, seedProject, seedTaskAccessOrg } from '../support/routes-harness';
import { ProcessDefinitionCreate, RecurrenceSeriesCreate } from '../../src/contracts/recurrence';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import { createRecurrenceSeries } from '../../src/lib/recurrence/series';
import { materializeOccurrence } from '../../src/lib/recurrence/materialize';
import { materializeTemplateOccurrence } from '../../src/lib/recurrence/work-template-adapter';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
function sourceId(ids: Readonly<Record<string, string>>, key: string): string {
  const id = ids[key];
  if (!id) throw new Error('Missing source fixture');
  return id;
}
async function partialFixture(allAtOnce = false) {
  const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const source = await createPublishedProcessDefinition(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definition: ProcessDefinitionCreate.parse({
      name: 'Retained dinner',
      creationMode: allAtOnce ? 'all_at_once' : 'when_ready',
      project: { key: 'dinner', name: 'Dinner', teamId: f.teamId },
      tasks: [
        { key: 'first', title: 'First', teamId: f.teamId, projectKey: 'dinner' },
        {
          key: 'second',
          title: 'Second',
          teamId: f.teamId,
          projectKey: 'dinner',
          timing: { kind: 'after_step_completion', stepKey: 'first', offsetDays: 2 },
        },
      ],
      dependencies: [{ blockingStepKey: 'first', blockedStepKey: 'second' }],
    }),
  });
  const series = await createRecurrenceSeries(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    series: RecurrenceSeriesCreate.parse({
      name: 'Dinner',
      processDefinitionId: source.definitionId,
      effectiveFrom: '2026-10-14',
      trigger: { kind: 'manual' },
    }),
  });
  const revision = one(
    await schema.db
      .select()
      .from(schema.recurrenceSeriesRevision)
      .where(eq(schema.recurrenceSeriesRevision.seriesId, series.id)),
  );
  const occurrence = one(
    await schema.db
      .insert(schema.processOccurrence)
      .values({
        organizationId: f.orgId,
        seriesId: series.id,
        seriesRevisionId: revision.id,
        scheduledFor: '2026-10-14',
        status: 'materialized',
        blueprintInvocationId: revision.blueprintInvocationId,
      })
      .returning(),
  );
  const instance = one(
    await schema.db
      .insert(schema.processInstance)
      .values({
        organizationId: f.orgId,
        definitionId: source.definitionId,
        revisionId: source.revisionId,
        occurrenceId: occurrence.id,
      })
      .returning(),
  );
  const root = await seedProject(schema.db, schema, f.statusId, {
    organizationId: f.orgId,
    name: 'Actual dinner',
    teamId: f.teamId,
    status: 'planned',
    description: 'Existing Project prose',
    createdBy: f.humanActorId,
  });
  const first = await seedTask(schema.db, schema, f.statusId, {
    organizationId: f.orgId,
    teamId: f.teamId,
    projectId: root.id,
    title: 'Actual first',
    description: 'Existing edited prose',
    state: 'todo',
    dueDate: null,
    createdBy: f.humanActorId,
  });
  await schema.db.insert(schema.processInstanceProject).values({
    organizationId: f.orgId,
    instanceId: instance.id,
    stepId: sourceId(source.stepIdsByKey, 'dinner'),
    projectId: root.id,
  });
  await schema.db.insert(schema.processInstanceTask).values({
    organizationId: f.orgId,
    instanceId: instance.id,
    stepId: sourceId(source.stepIdsByKey, 'first'),
    taskId: first.id,
  });
  return {
    ...f,
    source,
    series,
    revision,
    occurrence,
    instance,
    root,
    first,
    request: {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: series.id,
      seriesRevisionId: revision.id,
      occurrenceId: occurrence.id,
      instanceId: instance.id,
    },
  };
}
describe('approved all-at-once retained when-ready cutover', () => {
  it('preserves existing rows and creates each missing original step once, still waiting for its completion date', async () => {
    const f = await partialFixture();
    const result = await materializeOccurrence(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: f.series.id,
      seriesRevisionId: f.revision.id,
      scheduledFor: '2026-10-14',
    });
    expect(result.taskIdsByKey['first']).toBe(f.first.id);
    expect(result.taskIdsByKey['second']).toBeDefined();
    const retry = await materializeOccurrence(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: f.series.id,
      seriesRevisionId: f.revision.id,
      scheduledFor: '2026-10-14',
    });
    expect(retry).toEqual(result);
    const tasks = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, f.orgId));
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.id === f.first.id)).toMatchObject({
      title: 'Actual first',
      description: 'Existing edited prose',
      dueDate: null,
    });
    expect(tasks.find((task) => task.id === result.taskIdsByKey['second'])?.dueDate).toBeNull();
  });
  it('retains an already-present original dependency without duplicate linking or work', async () => {
    const f = await partialFixture(true);
    const second = await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      projectId: f.root.id,
      title: 'Existing second',
      state: 'todo',
      createdBy: f.humanActorId,
    });
    await schema.db.insert(schema.processInstanceTask).values({
      organizationId: f.orgId,
      instanceId: f.instance.id,
      stepId: sourceId(f.source.stepIdsByKey, 'second'),
      taskId: second.id,
    });
    await schema.db
      .insert(schema.taskDependency)
      .values({ organizationId: f.orgId, blockingTaskId: f.first.id, blockedTaskId: second.id });
    const result = await schema.db.transaction((tx) =>
      materializeTemplateOccurrence(tx, f.request),
    );
    expect(result.delta.createdTaskIdsByKey).toEqual({});
    expect(result.effects).toEqual([]);
    expect(
      await schema.db
        .select()
        .from(schema.taskDependency)
        .where(eq(schema.taskDependency.organizationId, f.orgId)),
    ).toHaveLength(1);
  });
});
