import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { getDb, seedTaskAccessOrg } from '../support/routes-harness';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import {
  createRecurrenceSeries,
  materializeSeriesOccurrence,
} from '../../src/lib/recurrence/series';
import { ProcessDefinitionCreate, RecurrenceSeriesCreate } from '../../src/contracts/recurrence';
import { retainedFixture } from './work-template-adapter-fixture';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function invocation(orgId: string, revisionId: string) {
  const rows = await schema.db
    .select()
    .from(schema.blueprintInvocation)
    .where(eq(schema.blueprintInvocation.organizationId, orgId));
  const row = rows.find((value) => value.manifest.legacyProcessRevisionId === revisionId);
  expect(row).toBeDefined();
  if (!row) throw new Error('Missing canonical binding');
  return row;
}
describe('canonical binding during compatibility process authoring', () => {
  it('retains an explicit standalone Task publication and keeps authored prose private', async () => {
    const f = await retainedFixture(schema);
    const result = await createPublishedProcessDefinition(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      definition: ProcessDefinitionCreate.parse({
        name: 'Reports',
        tasks: [
          {
            key: 'report',
            title: 'Report',
            teamId: f.teamId,
            description: 'Private scheduled instructions',
            workTypeId: f.published.id,
            workTypeVersionId: f.published.latestPublishedVersionId,
          },
        ],
      }),
    });
    const stored = await invocation(f.orgId, result.revisionId);
    expect(stored.manifest).toMatchObject({
      kind: 'published',
      roots: [
        {
          key: 'report',
          workTypeId: f.published.id,
          workTypeVersionId: f.published.latestPublishedVersionId,
        },
      ],
    });
    expect(stored.overrides[0]?.fields['description']).toContain('Private scheduled instructions');
    const series = await createRecurrenceSeries(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      series: RecurrenceSeriesCreate.parse({
        name: 'Reports',
        processDefinitionId: result.definitionId,
        trigger: { kind: 'manual' },
      }),
    });
    const revisions = await schema.db
      .select()
      .from(schema.recurrenceSeriesRevision)
      .where(eq(schema.recurrenceSeriesRevision.seriesId, series.id));
    expect(revisions[0]).toMatchObject({
      blueprintInvocationId: stored.id,
      workTypeId: f.published.id,
      workTypeVersionId: f.published.latestPublishedVersionId,
    });
  });
  it('keeps canonical Task summary and nullable effort through the strict legacy authoring adapter', async () => {
    const f = await retainedFixture(
      schema,
      false,
      undefined,
      WorkTemplateDefinition.parse({
        name: 'Canonical defaults',
        payload: {
          targetType: 'task',
          title: 'Report',
          summary: 'Canonical summary',
          estimateMinutes: null,
        },
      }),
    );
    const result = await createPublishedProcessDefinition(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      definition: ProcessDefinitionCreate.parse({
        name: 'Reports',
        tasks: [
          {
            key: 'report',
            title: 'Report',
            teamId: f.teamId,
            workTypeId: f.published.id,
            workTypeVersionId: f.published.latestPublishedVersionId,
          },
        ],
      }),
    });
    const stored = await invocation(f.orgId, result.revisionId);
    expect(stored.manifest.roots[0]).toMatchObject({
      workTypeId: f.published.id,
      workTypeVersionId: f.published.latestPublishedVersionId,
    });
    const series = await createRecurrenceSeries(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      series: RecurrenceSeriesCreate.parse({
        name: 'Reports',
        processDefinitionId: result.definitionId,
        effectiveFrom: '2026-10-14',
        trigger: { kind: 'manual' },
      }),
    });
    const occurrence = await materializeSeriesOccurrence(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: series.id,
      scheduledFor: '2026-10-14',
    });
    const rows = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, occurrence.taskIdsByKey['report'] ?? ''));
    expect(rows[0]).toMatchObject({
      summary: 'Canonical summary',
      estimateMinutes: null,
      workTypeId: f.published.id,
      workTypeVersionId: f.published.latestPublishedVersionId,
    });
  });
  it('publishes reusable hierarchy without literal destinations or private body', async () => {
    const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
    const result = await createPublishedProcessDefinition(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      definition: ProcessDefinitionCreate.parse({
        name: 'Dinner',
        project: {
          key: 'dinner',
          name: 'Dinner',
          description: 'PRIVATE PROJECT BODY',
          teamId: f.teamId,
        },
        tasks: [
          {
            key: 'invite',
            title: 'Invite',
            description: 'PRIVATE TASK BODY',
            teamId: f.teamId,
            projectKey: 'dinner',
          },
          {
            key: 'follow',
            title: 'Follow up',
            teamId: f.teamId,
            parentTaskKey: 'invite',
            projectKey: 'dinner',
          },
        ],
      }),
    });
    const stored = await invocation(f.orgId, result.revisionId);
    const root = stored.manifest.roots[0];
    expect(root).toBeDefined();
    const publications = await schema.db
      .select()
      .from(schema.workTypeVersion)
      .where(eq(schema.workTypeVersion.organizationId, f.orgId));
    const version = publications.find((row) => row.id === root?.workTypeVersionId);
    expect(version?.definition.blueprint.steps).toHaveLength(2);
    expect(JSON.stringify(version?.definition)).not.toContain('PRIVATE');
    expect(JSON.stringify(version?.definition)).not.toContain(f.teamId);
    expect(stored.manifest.steps.find((step) => step.sourceKey === 'follow')?.path).toEqual([
      'follow',
    ]);
  });
  it('splits extra authored children into canonical roots under the exact selected Task', async () => {
    const f = await retainedFixture(schema);
    const result = await createPublishedProcessDefinition(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      definition: ProcessDefinitionCreate.parse({
        name: 'Reports',
        tasks: [
          {
            key: 'report',
            title: 'Report',
            teamId: f.teamId,
            workTypeId: f.published.id,
            workTypeVersionId: f.published.latestPublishedVersionId,
          },
          { key: 'follow', title: 'Follow up', teamId: f.teamId, parentTaskKey: 'report' },
        ],
      }),
    });
    const stored = await invocation(f.orgId, result.revisionId);
    expect(stored.manifest.roots).toHaveLength(2);
    expect(stored.manifest.roots[0]).toMatchObject({
      key: 'report',
      workTypeId: f.published.id,
      workTypeVersionId: f.published.latestPublishedVersionId,
    });
    expect(
      stored.overrides.find((preset) => preset.sourceStepId === result.stepIdsByKey['follow'])
        ?.fields['parent_task_step_id'],
    ).toBe(result.stepIdsByKey['report']);
  });
});
