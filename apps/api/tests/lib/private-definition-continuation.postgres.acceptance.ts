import { afterAll, beforeAll, expect, it } from 'vitest';
import * as schema from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { ProcessDefinitionId, ProjectId } from '@docket/work/ids';
import {
  createPublishedProcessDefinition,
  loadProcessDefinitionDetail,
  createProcessDefinitionFromProject,
} from '../../src/lib/recurrence/process-definition';
import { listProcessDefinitions } from '../../src/lib/recurrence/process-definition-metadata';
import {
  createRecurrenceSeries,
  materializeSeriesOccurrence,
  loadRecurrenceSeriesDetail,
} from '../../src/lib/recurrence/series';

import { seedPrivatePublicationActor } from '../support/private-publication-fixture';
import {
  initializePrivateRuntimePostgres,
  withSourceDeniedPrivateActor as restricted,
  privateSourceCounts as sourceCounts,
} from '../support/private-definition-postgres-fixture';
beforeAll(initializePrivateRuntimePostgres);
afterAll(async () => {
  await schema.closeDb();
});

import { advanceNativeScheduleOccurrence } from '../../src/lib/recurrence/schedule-native-completion';
import { archiveLegacyDefinition } from '../../src/lib/recurrence/legacy-definition-archive';
it('continues a real authored Task completion once at month end and archives its private definition without source access', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema);
  const input = { organizationId: f.orgId, actorId: f.humanActorId };
  const saved = await restricted(f, async (tx) => {
    const publication = await createPublishedProcessDefinition(tx, {
      ...input,
      definition: ProcessDefinitionCreate.parse({
        name: 'Monthly completion',
        tasks: [{ key: 'one', title: 'Month Task', teamId: f.teamId }],
      }),
    });
    const series = await createRecurrenceSeries(tx, {
      ...input,
      series: {
        processDefinitionId: ProcessDefinitionId.parse(publication.definitionId),
        name: 'Monthly completion',
        effectiveFrom: '2027-01-31',
        trigger: { kind: 'after_completion', interval: 1, unit: 'month' },
      },
    });
    const run = await materializeSeriesOccurrence(tx, {
      ...input,
      seriesId: series.id,
      scheduledFor: '2027-01-31',
    });
    await tx
      .update(schema.task)
      .set({ completedAt: new Date('2027-01-31T20:00:00Z') })
      .where(eq(schema.task.id, assertDefined(run.taskIdsByKey['one'])));
    return { publication, series, run };
  });
  const outcomes = await Promise.all(
    [1, 2].map(() =>
      restricted(f, (tx) =>
        advanceNativeScheduleOccurrence(tx, { ...input, occurrenceId: saved.run.occurrenceId }),
      ),
    ),
  );
  expect(outcomes.every((result) => result.completed)).toBe(true);
  expect(outcomes[0]?.nextOccurrenceId).toBe(outcomes[1]?.nextOccurrenceId);
  const successors = await schema.db
    .select()
    .from(schema.processOccurrence)
    .where(eq(schema.processOccurrence.continuedFromOccurrenceId, saved.run.occurrenceId));
  expect(successors).toHaveLength(1);
  expect(successors[0]).toMatchObject({
    scheduledFor: '2027-02-28',
    status: 'materialized',
    externalOccurrenceKey: null,
  });
  await restricted(f, async (tx) => {
    await archiveLegacyDefinition(
      tx,
      { ...input, definitionId: saved.publication.definitionId },
      new Date(),
    );
    expect(await listProcessDefinitions(tx, f.orgId, { limit: 20 }, f.humanActorId)).toEqual([]);
    await expect(
      loadProcessDefinitionDetail(tx, f.orgId, saved.publication.definitionId, f.humanActorId),
    ).rejects.toThrow();
    expect(
      await loadRecurrenceSeriesDetail(tx, f.orgId, saved.series.id, f.humanActorId),
    ).toMatchObject({ status: 'ended' });
  });
});

it('captures a fully authorized real Project through the original from-project service and creates its qualified actual forest without process rows', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema);
  const statuses = await schema.db
    .select()
    .from(schema.workStatus)
    .where(eq(schema.workStatus.organizationId, f.orgId));
  const projectStatus = assertDefined(
    statuses.find((row) => row.entityType === 'project' && row.isDefault),
  );
  const taskStatus = assertDefined(
    statuses.find((row) => row.entityType === 'task' && row.isDefault),
  );
  const [sourceProject] = await schema.db
    .insert(schema.project)
    .values({
      organizationId: f.orgId,
      name: 'Actual source Project',
      teamId: f.teamId,
      status: projectStatus.key,
      statusId: projectStatus.id,
    })
    .returning();
  const source = assertDefined(sourceProject);
  await schema.db.insert(schema.task).values({
    organizationId: f.orgId,
    title: 'Actual source Task',
    teamId: f.teamId,
    projectId: source.id,
    state: taskStatus.key,
    statusId: taskStatus.id,
  });
  const { templates: _templatesBefore, ...before } = assertDefined((await sourceCounts())[0]);
  await restricted(f, async (database) => {
    const input = { organizationId: f.orgId, actorId: f.humanActorId };
    const published = await createProcessDefinitionFromProject(database, {
      ...input,
      input: { projectId: ProjectId.parse(source.id), creationMode: 'all_at_once' },
    });
    const detail = await loadProcessDefinitionDetail(
      database,
      f.orgId,
      published.definitionId,
      f.humanActorId,
    );
    expect(detail).toMatchObject({
      revision: { project: { key: 'project' }, tasks: [{ key: 'task-1', projectKey: 'project' }] },
    });
    const series = await createRecurrenceSeries(database, {
      ...input,
      series: {
        processDefinitionId: ProcessDefinitionId.parse(published.definitionId),
        name: 'Captured actual forest',
        effectiveFrom: '2026-11-01',
        trigger: { kind: 'manual' },
      },
    });
    const run = await materializeSeriesOccurrence(database, {
      ...input,
      seriesId: series.id,
      scheduledFor: '2026-11-01',
    });
    const [task] = await database
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(run.taskIdsByKey['task-1'])));
    expect(task?.projectId).toBe(run.projectIdsByKey['project']);
  });
  const { templates: _templatesAfter, ...after } = assertDefined((await sourceCounts())[0]);
  expect(after).toEqual(before);
});
