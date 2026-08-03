import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  getDb,
  one,
  seedBaseOrg,
  seedGoogleAccount,
  seedUserWithHub,
} from '../support/routes-harness';

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

  it('returns a resume cursor for paged source-table backfills', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const prefix = `000_paged_${Math.random().toString(36).slice(2, 8)}`;
    const rows = await db
      .insert(schema.task)
      .values(
        [`${prefix}_alpha`, `${prefix}_beta`].map((id) => ({
          id,
          organizationId: orgId,
          teamId,
          title: `Paged ${id}`,
          description: 'Paged backfill body',
          state: 'todo' as const,
          visibility: 'public' as const,
        })),
      )
      .returning({ id: schema.task.id });

    const first = await backfillSearchIndex({ sourceTables: ['task'], limit: 1 });
    expect(first.scanned).toBe(1);
    expect(first.enqueued).toBe(1);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await backfillSearchIndex({
      sourceTables: ['task'],
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.scanned).toBe(1);
    expect(second.enqueued).toBe(1);

    const jobs = await db
      .select({
        entityId: schema.searchIndexJob.entityId,
      })
      .from(schema.searchIndexJob)
      .where(eq(schema.searchIndexJob.reason, 'backfill'));
    expect(jobs.map((job) => job.entityId)).toEqual(
      expect.arrayContaining(rows.map((row) => row.id)),
    );
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

  it('applies the default source-table list and page limit when both are omitted', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Default-scan budget task',
          description: 'Exercises the omitted sourceTables/limit branches',
          state: 'todo',
          visibility: 'public',
        })
        .returning(),
    );

    const result = await backfillSearchIndex();

    expect(result.scanned).toBeGreaterThan(0);
    const jobs = await db
      .select()
      .from(schema.searchIndexJob)
      .where(
        and(
          eq(schema.searchIndexJob.sourceTable, 'task'),
          eq(schema.searchIndexJob.entityId, taskRow.id),
          eq(schema.searchIndexJob.reason, 'backfill'),
        ),
      );
    expect(jobs).toHaveLength(1);
  });

  it('stops immediately when a source-table entry is empty, scanning and enqueuing nothing', async () => {
    const result = await backfillSearchIndex({ sourceTables: [''], limit: 10 });
    expect(result).toEqual({ scanned: 0, enqueued: 0 });
  });

  it('treats a shape-invalid cursor as absent and restarts the scan from the first table', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Bad-cursor budget task',
          description: 'Exercises the cursor-shape-invalid fallback branch',
          state: 'todo',
          visibility: 'public',
        })
        .returning(),
    );
    // Valid JSON, valid base64url, but a negative sourceTableIndex fails the shape guard — the
    // decoder must fall back to "no cursor" rather than skipping ahead or throwing.
    const badCursor = Buffer.from(
      JSON.stringify({ sourceTableIndex: -1, rowId: 'whatever' }),
      'utf8',
    ).toString('base64url');

    const result = await backfillSearchIndex({
      sourceTables: ['task'],
      limit: 50,
      cursor: badCursor,
    });

    expect(result.scanned).toBeGreaterThanOrEqual(1);
    const jobs = await db
      .select()
      .from(schema.searchIndexJob)
      .where(
        and(
          eq(schema.searchIndexJob.sourceTable, 'task'),
          eq(schema.searchIndexJob.entityId, taskRow.id),
          eq(schema.searchIndexJob.reason, 'backfill'),
        ),
      );
    expect(jobs).toHaveLength(1);
  });

  it('applies the default source-table list and page limit for repair when both are omitted', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const sourceUpdatedAt = new Date('2026-07-05T12:00:00.000Z');
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Default-repair budget task',
          description: 'Exercises the omitted sourceTables/limit branches for repair',
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
      title: 'Stale default-repair title',
      facet: {},
      route: { type: 'entity', organizationId: orgId, entityKind: 'task', entityId: taskRow.id },
      visibility: { mode: 'org_members' },
      sourceUpdatedAt: new Date('2026-07-04T12:00:00.000Z'),
      indexedAt: new Date('2026-07-04T12:00:00.000Z'),
    });

    const result = await repairSearchIndex();

    expect(result.scanned).toBeGreaterThan(0);
    const jobs = await db
      .select()
      .from(schema.searchIndexJob)
      .where(
        and(
          eq(schema.searchIndexJob.sourceTable, 'task'),
          eq(schema.searchIndexJob.entityId, taskRow.id),
          eq(schema.searchIndexJob.reason, 'repair'),
        ),
      );
    expect(jobs).toHaveLength(1);
  });

  it('derives null organizationId and a string userId for a source row with no organization column', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'CalendarBackfillUser');
    const googleAccountId = `google-${Math.random().toString(36).slice(2, 8)}`;
    await seedGoogleAccount(db, schema, userId, googleAccountId);
    const connection = one(
      await db
        .insert(schema.calendarConnection)
        .values({
          userId,
          externalAccountId: googleAccountId,
          accountEmail: 'calendar-backfill@example.com',
          accountName: 'Calendar Backfill',
          status: 'connected',
        })
        .returning({ id: schema.calendarConnection.id }),
    );
    const calendarList = one(
      await db
        .insert(schema.calendarList)
        .values({
          userId,
          connectionId: connection.id,
          externalCalendarId: 'primary',
          title: 'Primary',
        })
        .returning({ id: schema.calendarList.id }),
    );
    const event = one(
      await db
        .insert(schema.calendarEvent)
        .values({
          userId,
          connectionId: connection.id,
          calendarId: calendarList.id,
          externalCalendarId: 'primary',
          externalEventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
          title: 'No-org calendar event',
          startsAt: new Date('2026-07-06T16:00:00.000Z'),
          endsAt: new Date('2026-07-06T17:00:00.000Z'),
        })
        .returning({ id: schema.calendarEvent.id }),
    );

    const result = await backfillSearchIndex({ sourceTables: ['calendar_event'], limit: 50 });
    expect(result.enqueued).toBeGreaterThanOrEqual(1);

    const [job] = await db
      .select({
        organizationId: schema.searchIndexJob.organizationId,
        userId: schema.searchIndexJob.userId,
      })
      .from(schema.searchIndexJob)
      .where(
        and(
          eq(schema.searchIndexJob.sourceTable, 'calendar_event'),
          eq(schema.searchIndexJob.entityId, event.id),
          eq(schema.searchIndexJob.reason, 'backfill'),
        ),
      )
      .limit(1);
    expect(job).toMatchObject({ organizationId: null, userId });
  });

  it('derives null organizationId and a string userId for a repaired row with no organization column', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'CalendarRepairUser');
    const googleAccountId = `google-${Math.random().toString(36).slice(2, 8)}`;
    await seedGoogleAccount(db, schema, userId, googleAccountId);
    const connection = one(
      await db
        .insert(schema.calendarConnection)
        .values({
          userId,
          externalAccountId: googleAccountId,
          accountEmail: 'calendar-repair@example.com',
          accountName: 'Calendar Repair',
          status: 'connected',
        })
        .returning({ id: schema.calendarConnection.id }),
    );
    const calendarList = one(
      await db
        .insert(schema.calendarList)
        .values({
          userId,
          connectionId: connection.id,
          externalCalendarId: 'primary',
          title: 'Primary',
        })
        .returning({ id: schema.calendarList.id }),
    );
    const event = one(
      await db
        .insert(schema.calendarEvent)
        .values({
          userId,
          connectionId: connection.id,
          calendarId: calendarList.id,
          externalCalendarId: 'primary',
          externalEventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
          title: 'No-org calendar event for repair',
          startsAt: new Date('2026-07-06T16:00:00.000Z'),
          endsAt: new Date('2026-07-06T17:00:00.000Z'),
        })
        .returning({ id: schema.calendarEvent.id }),
    );

    const result = await repairSearchIndex({ sourceTables: ['calendar_event'], limit: 50 });
    expect(result.enqueued).toBeGreaterThanOrEqual(1);

    const [job] = await db
      .select({
        organizationId: schema.searchIndexJob.organizationId,
        userId: schema.searchIndexJob.userId,
      })
      .from(schema.searchIndexJob)
      .where(
        and(
          eq(schema.searchIndexJob.sourceTable, 'calendar_event'),
          eq(schema.searchIndexJob.entityId, event.id),
          eq(schema.searchIndexJob.reason, 'repair'),
        ),
      )
      .limit(1);
    expect(job).toMatchObject({ organizationId: null, userId });
  });

  it('does not enqueue a second reindex job when an event has no reindexable entity', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const eventId = `event_no_target_${Math.random().toString(36).slice(2, 10)}`;
    await db.insert(schema.event).values({
      id: eventId,
      organizationId: orgId,
      createdBy: humanActorId,
      sourceSystem: 'docket',
      kind: 'comment',
      occurredAt: new Date('2026-07-06T09:00:00.000Z'),
      title: 'A comment with no canonical entity',
      summary: 'This event carries no entity reference at all',
      entityKind: null,
      dedupeKey: `test:${eventId}`,
    });

    const result = await repairSearchIndex({ sourceTables: ['event'], limit: 50 });
    expect(result.enqueued).toBeGreaterThanOrEqual(1);

    const jobs = await db
      .select({ sourceTable: schema.searchIndexJob.sourceTable })
      .from(schema.searchIndexJob)
      .where(eq(schema.searchIndexJob.sourceEventId, eventId));
    // Only the event's own upsert job — no second job pointing at a mapped Docket entity, since
    // this event's entity is null and eventSearchReindexTarget refuses to invent one.
    expect(jobs).toEqual([{ sourceTable: 'event' }]);
  });

  it('resolves freshness from an earlier timestamp column for a source table with no updatedAt', async () => {
    const schema = await getDb();
    const { db } = schema;
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const labelRow = one(
      await db
        .insert(schema.label)
        .values({
          organizationId: orgId,
          teamId,
          name: `Freshness-${Math.random().toString(36).slice(2, 8)}`,
          color: '#123456',
        })
        .returning({ id: schema.label.id }),
    );

    const result = await repairSearchIndex({ sourceTables: ['label'], limit: 50 });
    expect(result.scanned).toBeGreaterThanOrEqual(1);

    const jobs = await db
      .select()
      .from(schema.searchIndexJob)
      .where(
        and(
          eq(schema.searchIndexJob.sourceTable, 'label'),
          eq(schema.searchIndexJob.entityId, labelRow.id),
          eq(schema.searchIndexJob.reason, 'repair'),
        ),
      );
    expect(jobs).toHaveLength(1);
  });
});
