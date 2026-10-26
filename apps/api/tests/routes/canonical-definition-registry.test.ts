import type * as DbModule from '@docket/db';
import { beforeAll, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { backfillInvocationRevisionAliases } from '@docket/db';
import {
  ProcessDefinitionDetailOut,
  ProcessDefinitionSummaryOut,
} from '../../src/contracts/recurrence';
import { pageOf } from '../../src/contracts/pagination';
import { getDb } from '../support/routes-harness';
import processes from '../../src/routes/process-definitions';
import recurrence from '../../src/routes/recurrence-series';
import { legacyPrivacyFixture } from './legacy-schedule-privacy-fixture';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function fixture() {
  const f = await legacyPrivacyFixture(schema, processes, recurrence);
  await backfillInvocationRevisionAliases(schema.db, { batchSize: 1 });
  return f;
}
it('reads registered immutable bodies after normalized source changes, preserving private aliases', async () => {
  const f = await fixture();
  const response = await f.ownerProcesses.request(`/${f.published.definitionId}`);
  expect(response.status).toBe(200);
  const before = ProcessDefinitionDetailOut.parse(await response.json());
  const sourceStep = f.published.stepIdsByKey['prepare'];
  if (!sourceStep) throw new Error('Missing source step');
  await schema.db
    .update(schema.processTaskSpec)
    .set({ title: 'Changed normalized source' })
    .where(eq(schema.processTaskSpec.stepId, sourceStep));
  const reread = await f.ownerProcesses.request(`/${f.published.definitionId}`);
  expect(reread.status).toBe(200);
  expect(await reread.json()).toEqual(before);
  expect((await f.otherProcesses.request(`/${f.published.definitionId}`)).status).toBe(404);
});
it('edits canonical metadata without publishing or allowing stale source overwrite', async () => {
  const f = await fixture();
  const response = await f.ownerProcesses.request(`/${f.published.definitionId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Canonical dinner name', description: null }),
  });
  expect(response.status).toBe(200);
  const detail = await response.json();
  expect(detail).toMatchObject({
    name: 'Canonical dinner name',
    description: null,
    latestRevisionNumber: 1,
  });
  // Retained authoring keeps a normalized source row that must refuse a stale rename;
  // canonical authoring writes no such row.
  const sources = await schema.db
    .select({ id: schema.processDefinition.id })
    .from(schema.processDefinition)
    .where(eq(schema.processDefinition.id, f.published.definitionId));
  if (sources.length)
    await expect(
      schema.db
        .update(schema.processDefinition)
        .set({ name: 'Stale source overwrite' })
        .where(eq(schema.processDefinition.id, f.published.definitionId)),
    ).rejects.toThrow();
  await backfillInvocationRevisionAliases(schema.db);
  const listing = pageOf(ProcessDefinitionSummaryOut).parse(
    await (await f.ownerProcesses.request('/')).json(),
  );
  expect(
    listing.items.find((item: { id: string }) => item.id === f.published.definitionId)?.name,
  ).toBe('Canonical dinner name');
  const result = await schema.db.execute(
    sql`select count(*)::integer as count from work_template_invocation_revision where head_id=${f.published.definitionId}`,
  );
  expect((result as { rows: { count: number }[] }).rows[0]?.count).toBe(1);
});

it('bridges normalized publication atomically and reads complete alias history independently of head CAS', async () => {
  const f = await fixture();
  const { canonicalDefinitionHistory } =
    await import('../../src/lib/recurrence/canonical-definition');
  const input = {
    organizationId: f.orgId,
    actorId: f.actorId,
    definitionId: f.published.definitionId,
  };
  const before = ProcessDefinitionDetailOut.parse(
    await (await f.ownerProcesses.request(`/${f.published.definitionId}`)).json(),
  );
  const body = {
    name: 'Second dinner',
    creationMode: 'when_ready',
    tasks: [{ key: 'second', title: 'Second preparation', teamId: f.teamId, description: '' }],
  };
  const response = await f.ownerProcesses.request(`/${f.published.definitionId}/revisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const after = ProcessDefinitionDetailOut.parse(await response.json());
  expect(after).toMatchObject({
    name: 'Second dinner',
    latestRevisionNumber: 2,
    revision: {
      number: 2,
      tasks: [{ key: 'second', title: 'Second preparation', description: '' }],
    },
  });
  const first = await canonicalDefinitionHistory(schema.db, input, { limit: 1 });
  expect(first.items[0]?.id).toBe(after.revision.id);
  expect(first.nextNumber).toBe(2);
  const older = await canonicalDefinitionHistory(schema.db, input, { beforeNumber: 2, limit: 1 });
  expect(older.items[0]).toEqual(before.revision);
  expect(older.nextNumber).toBeNull();
  const archived = await f.ownerProcesses.request(`/${f.published.definitionId}`, {
    method: 'DELETE',
  });
  expect(archived.status).toBe(200);
  expect((await f.ownerProcesses.request(`/${f.published.definitionId}`)).status).toBe(404);
  expect(
    pageOf(ProcessDefinitionSummaryOut)
      .parse(await (await f.ownerProcesses.request('/')).json())
      .items.some((item) => item.id === f.published.definitionId),
  ).toBe(false);
});

it('keeps empty pending history nonexecuting and schedules the actual published alias', async () => {
  const f = await legacyPrivacyFixture(schema, processes, recurrence);
  const pendingId = schema.genId();
  await schema.db.insert(schema.processRevision).values({
    id: pendingId,
    organizationId: f.orgId,
    definitionId: f.published.definitionId,
    number: 4,
    creationMode: 'when_ready',
    publishedAt: null,
  });
  const { backfillWorkTemplateBlueprints } = await import('@docket/db');
  await backfillWorkTemplateBlueprints(schema.db);
  await backfillInvocationRevisionAliases(schema.db);
  const detail = ProcessDefinitionDetailOut.parse(
    await (await f.ownerProcesses.request(`/${f.published.definitionId}`)).json(),
  );
  expect(detail).toMatchObject({
    latestRevisionNumber: 4,
    revision: { id: pendingId, number: 4, publishedAt: null, tasks: [], milestones: [] },
  });
  const { createRecurrenceSeries } = await import('../../src/lib/recurrence/series');
  const created = await createRecurrenceSeries(schema.db, {
    organizationId: f.orgId,
    actorId: f.actorId,
    series: {
      name: 'Published dinner only',
      processDefinitionId: detail.id,
      effectiveFrom: '2026-10-15',
      trigger: { kind: 'manual' },
    },
  });
  const [revision] = await schema.db
    .select()
    .from(schema.recurrenceSeriesRevision)
    .where(eq(schema.recurrenceSeriesRevision.seriesId, created.id));
  expect(revision?.processRevisionId).toBe(f.published.revisionId);
  expect(revision?.scheduleDraft).toBeNull();
});
