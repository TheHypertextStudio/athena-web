import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getDb, one, seedBaseOrg } from '../routes/harness.test';

import { backfillSearchIndex } from '../../src/search/backfill';
import { enqueueSearchIndexJob } from '../../src/search/enqueue';
import { processSearchIndexJobs } from '../../src/search/process-jobs';

describe('search index jobs', () => {
  it('dedupes pending jobs and idempotently upserts projected documents', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Index budget task',
          description: 'Budget task body',
          state: 'todo',
          visibility: 'public',
        })
        .returning(),
    );

    await enqueueSearchIndexJob({
      organizationId: orgId,
      sourceTable: 'task',
      entityId: taskRow.id,
      operation: 'upsert',
      reason: 'entity_write',
    });
    await enqueueSearchIndexJob({
      organizationId: orgId,
      sourceTable: 'task',
      entityId: taskRow.id,
      operation: 'upsert',
      reason: 'entity_write',
    });

    const pending = await db
      .select()
      .from(schema.searchIndexJob)
      .where(
        and(
          eq(schema.searchIndexJob.sourceTable, 'task'),
          eq(schema.searchIndexJob.entityId, taskRow.id),
          eq(schema.searchIndexJob.status, 'pending'),
        ),
      );
    expect(pending).toHaveLength(1);

    const firstRun = await processSearchIndexJobs({ limit: 10 });
    const secondRun = await processSearchIndexJobs({ limit: 10 });
    expect(firstRun).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    expect(secondRun.processed).toBe(0);

    const docs = await db
      .select()
      .from(schema.searchDocument)
      .where(eq(schema.searchDocument.entityId, taskRow.id));
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      kind: 'task',
      family: 'work',
      title: 'Index budget task',
      sourceTable: 'task',
      organizationId: orgId,
    });
  });

  it('archives documents for delete jobs', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId } = await seedBaseOrg(db, schema);
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:task_delete`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'task_delete',
      title: 'Delete me',
      facet: {},
      route: { type: 'entity', organizationId: orgId, entityKind: 'task', entityId: 'task_delete' },
      visibility: { mode: 'org_members' },
    });
    await enqueueSearchIndexJob({
      organizationId: orgId,
      sourceTable: 'task',
      entityId: 'task_delete',
      operation: 'delete',
      reason: 'entity_write',
    });

    const result = await processSearchIndexJobs({ limit: 10 });
    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });

    const [doc] = await db
      .select()
      .from(schema.searchDocument)
      .where(eq(schema.searchDocument.entityId, 'task_delete'))
      .limit(1);
    expect(doc?.archivedAt).toBeInstanceOf(Date);
  });

  it('marks failed jobs with attempts, error, and retry delay', async () => {
    const schema = await getDb();
    const { db } = schema;
    await enqueueSearchIndexJob({
      sourceTable: 'unknown_source',
      entityId: 'missing_1',
      operation: 'upsert',
      reason: 'manual',
    });

    const result = await processSearchIndexJobs({ limit: 10 });
    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });

    const [job] = await db
      .select()
      .from(schema.searchIndexJob)
      .where(eq(schema.searchIndexJob.sourceTable, 'unknown_source'))
      .limit(1);
    expect(job).toMatchObject({ status: 'failed', attempts: 1 });
    expect(job?.lastError).toContain('No search projector registered');
    expect(job?.runAfter.getTime()).toBeGreaterThan(job?.createdAt.getTime() ?? 0);
  });

  it('backfills source rows without duplicating pending jobs', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Backfill budget task',
          description: 'Backfill body',
          state: 'todo',
          visibility: 'public',
        })
        .returning(),
    );

    await backfillSearchIndex({ sourceTables: ['task'], limit: 50 });
    await backfillSearchIndex({ sourceTables: ['task'], limit: 50 });

    const jobs = await db
      .select()
      .from(schema.searchIndexJob)
      .where(
        and(
          eq(schema.searchIndexJob.sourceTable, 'task'),
          eq(schema.searchIndexJob.entityId, taskRow.id),
          eq(schema.searchIndexJob.reason, 'backfill'),
          eq(schema.searchIndexJob.status, 'pending'),
        ),
      );
    expect(jobs).toHaveLength(1);
  });
});
