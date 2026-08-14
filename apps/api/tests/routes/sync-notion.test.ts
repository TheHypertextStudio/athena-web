/**
 * `@docket/api` — the sync conflict log: the record of a losing external value.
 *
 * @remarks
 * The whole point of this module is that "Docket wins" never means "the other side's value
 * vanished without a trace" — these tests assert the trace is actually queryable per integration,
 * scoped by organization, and never confused with an integration's ordinary audit history.
 */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type {
  asSyncConflictRecord as AsSyncConflictRecord,
  listSyncConflicts as ListSyncConflicts,
  recordSyncConflict as RecordSyncConflict,
} from '../../src/routes/sync-notion';
import type { TaskSyncConflict } from '../../src/routes/integration-reconcile';
import { getDb, seedBaseOrg } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let recordSyncConflict!: typeof RecordSyncConflict;
let listSyncConflicts!: typeof ListSyncConflicts;
let asSyncConflictRecord!: typeof AsSyncConflictRecord;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ recordSyncConflict, listSyncConflicts, asSyncConflictRecord } =
    await import('../../src/routes/sync-notion'));
});

const CONFLICT: TaskSyncConflict = {
  externalId: 'notion-page-1',
  remoteUpdatedAt: '2026-08-01T10:00:00.000Z',
  localUpdatedAt: '2026-08-01T10:05:00.000Z',
  remoteTitle: 'Ship the launch checklist',
  remoteBody: 'Notion had its own description.',
  remoteDueDate: '2026-08-15',
  remoteCompleted: false,
};

describe('sync conflict log', () => {
  it('records a losing remote value against the winning task', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [integration] = await db
      .insert(schema.integration)
      .values({ organizationId: orgId, provider: 'notion', pattern: 'connector' })
      .returning({ id: schema.integration.id });
    const [task] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: 'Ship the launch checklist',
        teamId,
        state: 'backlog',
      })
      .returning({ id: schema.task.id });

    await recordSyncConflict(
      orgId,
      humanActorId,
      assertDefined(integration).id,
      'notion',
      assertDefined(task).id,
      CONFLICT,
    );

    const [row] = await db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.subjectId, assertDefined(task).id));
    expect(row).toMatchObject({
      organizationId: orgId,
      actorId: humanActorId,
      subjectType: 'task',
      type: 'updated',
    });
    expect(asSyncConflictRecord(assertDefined(row).metadata)).toMatchObject({
      kind: 'sync_conflict',
      provider: 'notion',
      integrationId: assertDefined(integration).id,
      resolution: 'docket_wins',
      externalId: 'notion-page-1',
      remoteTitle: 'Ship the launch checklist',
      remoteDueDate: '2026-08-15',
      remoteCompleted: false,
    });
  });

  it('records a system-attributed conflict (no actor) when a sweep ran it', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const [integration] = await db
      .insert(schema.integration)
      .values({ organizationId: orgId, provider: 'notion', pattern: 'connector' })
      .returning({ id: schema.integration.id });
    const [task] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, title: 'Automated sync', teamId, state: 'backlog' })
      .returning({ id: schema.task.id });

    await recordSyncConflict(
      orgId,
      null,
      assertDefined(integration).id,
      'notion',
      assertDefined(task).id,
      CONFLICT,
    );

    const [row] = await db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.subjectId, assertDefined(task).id));
    expect(row?.actorId).toBeNull();
  });

  it('normalizes optional-undefined remote fields to explicit nulls', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const [integration] = await db
      .insert(schema.integration)
      .values({ organizationId: orgId, provider: 'notion', pattern: 'connector' })
      .returning({ id: schema.integration.id });
    const [task] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, title: 'No due date', teamId, state: 'backlog' })
      .returning({ id: schema.task.id });

    await recordSyncConflict(
      orgId,
      null,
      assertDefined(integration).id,
      'notion',
      assertDefined(task).id,
      {
        ...CONFLICT,
        remoteDueDate: undefined,
        remoteCompleted: undefined,
      },
    );

    const [row] = await db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.subjectId, assertDefined(task).id));
    const record = asSyncConflictRecord(assertDefined(row).metadata);
    expect(record?.remoteDueDate).toBeNull();
    expect(record?.remoteCompleted).toBeNull();
  });

  it('lists conflicts for one integration, newest first, ignoring other orgs and other kinds', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [integration] = await db
      .insert(schema.integration)
      .values({ organizationId: orgId, provider: 'notion', pattern: 'connector' })
      .returning({ id: schema.integration.id });
    const [otherIntegration] = await db
      .insert(schema.integration)
      .values({ organizationId: orgId, provider: 'linear', pattern: 'connector' })
      .returning({ id: schema.integration.id });
    const [task] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, title: 'Task A', teamId, state: 'backlog' })
      .returning({ id: schema.task.id });

    // An ordinary audit row (no `metadata.kind`) must never surface as a conflict.
    await db.insert(schema.auditEvent).values({
      organizationId: orgId,
      actorId: humanActorId,
      subjectType: 'task',
      subjectId: assertDefined(task).id,
      type: 'updated',
      metadata: { note: 'plain audit row' },
    });
    // A conflict on a different integration must not leak into this integration's list.
    await recordSyncConflict(
      orgId,
      null,
      assertDefined(otherIntegration).id,
      'linear',
      assertDefined(task).id,
      CONFLICT,
    );

    await recordSyncConflict(
      orgId,
      null,
      assertDefined(integration).id,
      'notion',
      assertDefined(task).id,
      {
        ...CONFLICT,
        externalId: 'first',
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordSyncConflict(
      orgId,
      null,
      assertDefined(integration).id,
      'notion',
      assertDefined(task).id,
      {
        ...CONFLICT,
        externalId: 'second',
      },
    );

    const conflicts = await listSyncConflicts(orgId, assertDefined(integration).id);
    expect(conflicts.map((c) => c.conflict.externalId)).toEqual(['second', 'first']);
    expect(conflicts.every((c) => c.conflict.integrationId === assertDefined(integration).id)).toBe(
      true,
    );
  });

  it('scopes conflicts to the requesting organization', async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const [integrationA] = await db
      .insert(schema.integration)
      .values({ organizationId: orgA.orgId, provider: 'notion', pattern: 'connector' })
      .returning({ id: schema.integration.id });
    const [taskA] = await db
      .insert(schema.task)
      .values({
        organizationId: orgA.orgId,
        title: 'Org A task',
        teamId: orgA.teamId,
        state: 'backlog',
      })
      .returning({ id: schema.task.id });
    await recordSyncConflict(
      orgA.orgId,
      null,
      assertDefined(integrationA).id,
      'notion',
      assertDefined(taskA).id,
      CONFLICT,
    );

    expect(await listSyncConflicts(orgB.orgId, assertDefined(integrationA).id)).toEqual([]);
  });

  it('rejects metadata that is not a sync-conflict record', () => {
    expect(asSyncConflictRecord(null)).toBeNull();
    expect(asSyncConflictRecord('not an object')).toBeNull();
    expect(asSyncConflictRecord({ note: 'plain audit row' })).toBeNull();
    expect(asSyncConflictRecord({ kind: 'sync_conflict', externalId: 'x' })).toBeNull();
    expect(
      asSyncConflictRecord({ kind: 'sync_conflict', externalId: 'x', integrationId: 42 }),
    ).toBeNull();
  });
});
