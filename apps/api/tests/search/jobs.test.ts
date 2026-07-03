import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getDb, one, seedBaseOrg } from '../routes/harness.test';

import { backfillSearchIndex, repairSearchIndex } from '../../src/search/backfill';
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

  it('repair-enqueues source rows whose search document is missing or stale', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const sourceUpdatedAt = new Date('2026-07-03T12:00:00.000Z');
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Repair stale task',
          description: 'Repair body',
          state: 'todo',
          visibility: 'public',
          updatedAt: sourceUpdatedAt,
        })
        .returning(),
    );
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:${taskRow.id}`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: taskRow.id,
      title: 'Old repair title',
      facet: {},
      route: { type: 'entity', organizationId: orgId, entityKind: 'task', entityId: taskRow.id },
      visibility: { mode: 'org_members' },
      sourceUpdatedAt: new Date('2026-07-02T12:00:00.000Z'),
      indexedAt: new Date('2026-07-02T12:00:00.000Z'),
    });

    const result = await repairSearchIndex({ sourceTables: ['task'], limit: 50 });

    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.enqueued).toBeGreaterThanOrEqual(1);
    const jobs = await db
      .select()
      .from(schema.searchIndexJob)
      .where(
        and(
          eq(schema.searchIndexJob.sourceTable, 'task'),
          eq(schema.searchIndexJob.entityId, taskRow.id),
          eq(schema.searchIndexJob.reason, 'repair'),
          eq(schema.searchIndexJob.status, 'pending'),
        ),
      );
    expect(jobs).toHaveLength(1);
  });

  it('repair-reconciles newer event-log rows and their mapped Docket entities', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Event repair task',
          description: 'Event repair body',
          state: 'todo',
          visibility: 'public',
        })
        .returning(),
    );
    await db.insert(schema.searchDocument).values({
      id: `activity:${orgId}:event_old_indexed`,
      organizationId: orgId,
      kind: 'activity',
      family: 'activity',
      sourceTable: 'event',
      entityId: 'event_old_indexed',
      sourceSystem: 'docket',
      title: 'Old indexed event',
      facet: {},
      route: {
        type: 'activity',
        organizationId: orgId,
        eventId: 'event_old_indexed',
        href: `/orgs/${orgId}/stream?eventId=event_old_indexed`,
      },
      visibility: { mode: 'event' },
      occurredAt: new Date('2026-07-02T08:00:00.000Z'),
      indexedAt: new Date('2026-07-02T08:01:00.000Z'),
    });
    await db.insert(schema.event).values({
      id: 'event_new_repair',
      organizationId: orgId,
      createdBy: humanActorId,
      sourceSystem: 'docket',
      kind: 'status_change',
      occurredAt: new Date('2026-07-03T08:00:00.000Z'),
      title: 'New event repair',
      summary: 'A task changed after the last indexed activity row',
      entity: {
        kind: 'work_item',
        source: 'docket',
        externalId: taskRow.id,
        title: taskRow.title,
        url: null,
        docketEntityId: taskRow.id,
      },
      entityKind: 'work_item',
      dedupeKey: 'test:event_new_repair',
    });

    const result = await repairSearchIndex({ sourceTables: ['event'], limit: 50 });

    expect(result.enqueued).toBeGreaterThanOrEqual(2);
    const jobs = await db
      .select({
        sourceTable: schema.searchIndexJob.sourceTable,
        entityId: schema.searchIndexJob.entityId,
        sourceEventId: schema.searchIndexJob.sourceEventId,
        reason: schema.searchIndexJob.reason,
      })
      .from(schema.searchIndexJob)
      .where(eq(schema.searchIndexJob.sourceEventId, 'event_new_repair'));
    expect(jobs).toEqual(
      expect.arrayContaining([
        {
          sourceTable: 'event',
          entityId: 'event_new_repair',
          sourceEventId: 'event_new_repair',
          reason: 'repair',
        },
        {
          sourceTable: 'task',
          entityId: taskRow.id,
          sourceEventId: 'event_new_repair',
          reason: 'repair',
        },
      ]),
    );
  });
});
