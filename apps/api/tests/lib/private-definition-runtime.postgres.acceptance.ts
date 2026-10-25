import { afterAll, beforeAll, expect, it } from 'vitest';
import * as schema from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { eq, sql } from 'drizzle-orm';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { ProcessDefinitionId } from '@docket/work/ids';
import {
  createPublishedProcessDefinition,
  appendPublishedProcessRevision,
  loadProcessDefinitionDetail,
} from '../../src/lib/recurrence/process-definition';
import {
  listProcessDefinitions,
  updateProcessDefinitionMetadata,
} from '../../src/lib/recurrence/process-definition-metadata';
import {
  createRecurrenceSeries,
  materializeSeriesOccurrence,
  loadRecurrenceSeriesDetail,
  loadGeneratedWorkRecurrence,
  editRecurrenceSeries,
} from '../../src/lib/recurrence/series';
import { rawResultRows } from '../../src/lib/raw-result';
import { seedPrivatePublicationActor } from '../support/private-publication-fixture';
import {
  initializePrivateRuntimePostgres,
  withSourceDeniedPrivateActor as restricted,
  privateSourceCounts as sourceCounts,
  registerPendingPrivateAlias as pendingAlias,
} from '../support/private-definition-postgres-fixture';
beforeAll(initializePrivateRuntimePostgres);
afterAll(async () => {
  await schema.closeDb();
});

it('defines, appends, lists, reopens, schedules, executes and reads history/backlink through public compatibility services with all source tables denied', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema),
    before = await sourceCounts();
  const definition = ProcessDefinitionCreate.parse({
    name: 'Public private schedule',
    tasks: [
      {
        key: 'task-one',
        title: 'Exact {month}',
        description: 'Private\n\n',
        teamId: f.teamId,
        dueOffsetDays: 2,
      },
    ],
  });
  await restricted(f, async (tx) => {
    const input = { organizationId: f.orgId, actorId: f.humanActorId };
    const first = await createPublishedProcessDefinition(tx, { ...input, definition });
    const second = await appendPublishedProcessRevision(tx, {
      ...input,
      definitionId: first.definitionId,
      revision: definition,
    });
    expect(second.revisionNumber).toBe(2);
    await updateProcessDefinitionMetadata(tx, {
      ...input,
      definitionId: first.definitionId,
      patch: { name: 'Saved private name' },
    });
    expect(await listProcessDefinitions(tx, f.orgId, { limit: 20 }, f.humanActorId)).toMatchObject([
      { id: first.definitionId, name: 'Saved private name', latestRevisionNumber: 2 },
    ]);
    expect(
      await loadProcessDefinitionDetail(tx, f.orgId, first.definitionId, f.humanActorId),
    ).toMatchObject({
      revision: { id: second.revisionId, tasks: [{ key: 'task-one', description: 'Private\n\n' }] },
    });
    const series = await createRecurrenceSeries(tx, {
      ...input,
      series: {
        processDefinitionId: ProcessDefinitionId.parse(first.definitionId),
        name: 'My runs',
        effectiveFrom: '2026-10-25',
        trigger: { kind: 'manual' },
      },
    });
    const run = await materializeSeriesOccurrence(tx, {
      ...input,
      seriesId: series.id,
      scheduledFor: '2026-10-25',
    });
    const taskId = run.taskIdsByKey['task-one'];
    expect(taskId).toBeTruthy();
    expect(await loadRecurrenceSeriesDetail(tx, f.orgId, series.id, f.humanActorId)).toMatchObject({
      occurrences: [{ taskId, processInstanceId: run.instanceId }],
    });
    expect(
      await loadGeneratedWorkRecurrence(tx, {
        ...input,
        kind: 'task',
        taskId: assertDefined(taskId),
      }),
    ).toMatchObject({
      processDefinitionId: first.definitionId,
      processInstanceId: run.instanceId,
      occurrenceId: run.occurrenceId,
    });
  });
  expect(await sourceCounts()).toEqual(before);
});

it('refuses raw checkpoint authority and stale normalized authoring for an ordinary source-denied actor', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema);
  await restricted(f, async (tx) => {
    expect(
      rawResultRows(await tx.execute(sql`select * from work_template_alias_reference_checkpoint`)),
    ).toEqual([]);
    expect(
      rawResultRows(
        await tx.execute(
          sql`update work_template_alias_reference_checkpoint set enforced_at=null,review_code='coverage_pending' returning singleton`,
        ),
      ),
    ).toEqual([]);
    expect(
      rawResultRows<{ ready: boolean }>(
        await tx.execute(sql`select docket_private_alias_references_enforced() as ready`),
      )[0]?.ready,
    ).toBe(true);
  });
  await expect(
    restricted(f, (tx) => tx.execute(sql`select docket_enforce_private_alias_references()`)),
  ).rejects.toThrow();
  await expect(
    schema.db.execute(
      sql`insert into process_definition(id,organization_id,name,status) values(${schema.genId()},${f.orgId},'Stale normalized writer','draft')`,
    ),
  ).rejects.toThrow();
});

it('admits its actual published alias and refuses pending, wrong-head and changed definition identities in PostgreSQL', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema);
  const input = { organizationId: f.orgId, actorId: f.humanActorId };
  const definition = ProcessDefinitionCreate.parse({
    name: 'Published identity',
    tasks: [{ key: 'one', title: 'One', teamId: f.teamId }],
  });
  const first = await createPublishedProcessDefinition(schema.db, { ...input, definition });
  const other = await createPublishedProcessDefinition(schema.db, { ...input, definition });
  const series = await createRecurrenceSeries(schema.db, {
    ...input,
    series: {
      processDefinitionId: ProcessDefinitionId.parse(first.definitionId),
      name: 'Positive published control',
      effectiveFrom: '2026-10-25',
      trigger: { kind: 'manual' },
    },
  });
  const pending = await pendingAlias(f, first.revisionId);
  await expect(
    schema.db.insert(schema.recurrenceSeriesRevision).values({
      organizationId: f.orgId,
      seriesId: series.id,
      processRevisionId: pending.id,
      blueprintInvocationId: pending.invocationId,
      number: 2,
      effectiveFrom: '2026-10-26',
      triggerKind: 'manual',
    }),
  ).rejects.toThrow();
  const [otherAlias] = await schema.db
    .select()
    .from(schema.invocationRevision)
    .where(eq(schema.invocationRevision.id, other.revisionId));
  await expect(
    schema.db.insert(schema.recurrenceSeriesRevision).values({
      organizationId: f.orgId,
      seriesId: series.id,
      processRevisionId: other.revisionId,
      blueprintInvocationId: otherAlias?.invocationId,
      number: 2,
      effectiveFrom: '2026-10-26',
      triggerKind: 'manual',
    }),
  ).rejects.toThrow();
  await expect(
    schema.db
      .update(schema.recurrenceSeries)
      .set({ definitionId: other.definitionId })
      .where(eq(schema.recurrenceSeries.id, series.id)),
  ).rejects.toThrow();
});

it('saves a future private revision and retires unfinished generated work without reading source instance maps', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema);
  await restricted(f, async (tx) => {
    const input = { organizationId: f.orgId, actorId: f.humanActorId };
    const publication = await createPublishedProcessDefinition(tx, {
      ...input,
      definition: ProcessDefinitionCreate.parse({
        name: 'Future private work',
        tasks: [{ key: 'one', title: 'Future Task', teamId: f.teamId }],
      }),
    });
    const series = await createRecurrenceSeries(tx, {
      ...input,
      series: {
        processDefinitionId: ProcessDefinitionId.parse(publication.definitionId),
        name: 'Future private series',
        effectiveFrom: '2026-10-25',
        trigger: { kind: 'manual' },
      },
    });
    const old = await materializeSeriesOccurrence(tx, {
      ...input,
      seriesId: series.id,
      scheduledFor: '2026-11-15',
    });
    const edited = await editRecurrenceSeries(tx, {
      ...input,
      seriesId: series.id,
      asOf: '2026-10-25',
      edit: { scope: 'future', effectiveFrom: '2026-11-01', trigger: { kind: 'manual' } },
    });
    expect(edited.revisions).toHaveLength(2);
    const [task] = await tx
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, assertDefined(old.taskIdsByKey['one'])));
    expect(task?.archivedAt).not.toBeNull();
    const next = await materializeSeriesOccurrence(tx, {
      ...input,
      seriesId: series.id,
      scheduledFor: '2026-11-15',
    });
    expect(next.occurrenceId).not.toBe(old.occurrenceId);
    expect(next.taskIdsByKey['one']).not.toBe(old.taskIdsByKey['one']);
  });
});
