import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ExternalWriteResult, ImportedItem, WritableConnector } from '@docket/integrations';

import type * as ReconcileModule from '../../src/routes/integration-reconcile';
import { getDb, one, seedBaseOrg, seedStatus, seedStatuses } from '../support/routes-harness';

/**
 * `reconcileTasks` orchestration tests — the DB-backed sibling of
 * `integration-reconcile.test.ts` (which only exercises the pure `planTaskReconcile`
 * function). These cover the per-action branches (`pull`/`push` with conflict/`pushDelete`/
 * `archive`) and the entirely-untested helpers (`applyPull`, `pushDelete`, `archiveLocal`,
 * `pushNativeCreates`), calling `reconcileTasks` directly against the pglite harness rather
 * than through the HTTP route (which requires resolving a live provider credential).
 */
let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let reconcileTasks!: typeof ReconcileModule.reconcileTasks;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  reconcileTasks = (await import('../../src/routes/integration-reconcile')).reconcileTasks;
});

const NOW_ISO = '2026-06-01T00:00:00.000Z';
const OLD_ISO = '2026-01-01T00:00:00.000Z';
const NEWER_ISO = '2026-07-01T00:00:00.000Z';

/** Seed a `gtasks` connector integration row. */
async function seedIntegration(
  orgId: string,
  actorId: string,
  overrides: Partial<typeof schema.integration.$inferInsert> = {},
): Promise<typeof schema.integration.$inferSelect> {
  return one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'gtasks',
        pattern: 'connector',
        roles: ['work'],
        writeBack: true,
        createdBy: actorId,
        ...overrides,
      })
      .returning(),
  );
}

/** Seed a linked task (already mirrored from a prior sync). */
async function seedLinkedTask(
  orgId: string,
  teamId: string,
  integrationId: string,
  overrides: Partial<typeof schema.task.$inferInsert> = {},
): Promise<typeof schema.task.$inferSelect> {
  const statusId = await seedStatuses(db, schema, orgId);
  const state = overrides.state ?? 'todo';
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Linked task',
        source: 'linked',
        sourceIntegrationId: integrationId,
        sourceSyncMode: 'mirror',
        externalId: 'ext-1',
        externalUpdatedAt: new Date(OLD_ISO),
        updatedAt: new Date(OLD_ISO),
        ...overrides,
        state,
        statusId: statusId('task', state),
      })
      .returning(),
  );
}

/** Seed a native (never-synced) task. */
async function seedNativeTask(
  orgId: string,
  teamId: string,
  overrides: Partial<typeof schema.task.$inferInsert> = {},
): Promise<typeof schema.task.$inferSelect> {
  const statusId = await seedStatuses(db, schema, orgId);
  const state = overrides.state ?? 'todo';
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Native task',
        source: 'native',
        ...overrides,
        state,
        statusId: statusId('task', state),
      })
      .returning(),
  );
}

async function loadTask(taskId: string): Promise<typeof schema.task.$inferSelect> {
  return one(await db.select().from(schema.task).where(eq(schema.task.id, taskId)));
}

function remoteItem(
  over: Partial<ImportedItem> & { externalUpdatedAt?: string } = {},
): ImportedItem {
  const { externalUpdatedAt, ...rest } = over;
  return {
    id: 'ext-1',
    kind: 'issue',
    title: 'Remote title',
    provenance: {
      provider: 'gtasks',
      externalId: 'ext-1',
      importedAt: NOW_ISO,
      ...(externalUpdatedAt !== undefined ? { externalUpdatedAt } : {}),
    },
    ...rest,
  };
}

/** A `WritableConnector` fake recording every push and returning a scripted result. */
function fakeWritable(impl?: (op: unknown) => ExternalWriteResult | undefined): {
  connector: WritableConnector;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    connector: {
      pushTask: async (input) => {
        calls.push(input.op);
        return impl ? impl(input.op) : { externalId: 'ext-1', externalUpdatedAt: NEWER_ISO };
      },
    },
  };
}

describe('reconcileTasks', () => {
  it('throws ConflictError when the team cannot be resolved in this org', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    await expect(
      reconcileTasks(orgId, humanActorId, integration, 'not-a-real-team-id', [], {
        assigneeId: null,
        writable: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('ignores a "linked" task row with no externalId when indexing local tasks', async () => {
    // Not DB-enforced (no CHECK constraint ties `source='linked'` to a non-null `externalId`),
    // so a corrupted/legacy row like this is a real defensive case, not just type-level noise.
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    await seedLinkedTask(orgId, teamId, integration.id, { externalId: null });

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: null,
    });

    // The row is simply invisible to reconciliation — no crash, no action taken on it.
    expect(tally).toEqual({
      inserted: 0,
      pulled: 0,
      pushed: 0,
      deleted: 0,
      archived: 0,
      created: 0,
      conflicts: 0,
    });
  });

  it('pull: applies a newer remote onto a clean local task and tallies pulled', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const local = await seedLinkedTask(orgId, teamId, integration.id, { externalId: 'ext-pull' });
    const item = remoteItem({
      id: 'ext-pull',
      title: 'Updated remotely',
      body: 'fresh body',
      completed: true,
      dueDate: '2026-08-01',
      provenance: {
        provider: 'gtasks',
        externalId: 'ext-pull',
        importedAt: NOW_ISO,
        externalUpdatedAt: NEWER_ISO,
      },
    });

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: null,
    });

    expect(tally).toMatchObject({ pulled: 1, inserted: 0, pushed: 0, deleted: 0, archived: 0 });
    const updated = await loadTask(local.id);
    expect(updated.title).toBe('Updated remotely');
    expect(updated.description).toBe('fresh body');
    expect(updated.state).toBe('done'); // completed:true -> team's completed-type state
    expect(updated.externalUpdatedAt?.toISOString()).toBe(NEWER_ISO);
    expect(updated.updatedAt.toISOString()).toBe(NEWER_ISO); // echo guard
  });

  it('push with conflict: both sides changed — Docket wins, the write pushes, and the loss is logged', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId, { writeBack: true });
    const local = await seedLinkedTask(orgId, teamId, integration.id, {
      externalId: 'ext-conflict',
      title: 'Docket wins this title',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'), // dirty, older than the remote edit
      externalUpdatedAt: new Date(OLD_ISO),
    });
    const item = remoteItem({
      id: 'ext-conflict',
      title: 'Notion title (loses)',
      body: 'losing body',
      provenance: {
        provider: 'gtasks',
        externalId: 'ext-conflict',
        importedAt: NOW_ISO,
        externalUpdatedAt: NEWER_ISO, // newer than the anchor -> genuine two-sided conflict
      },
    });
    const { connector, calls } = fakeWritable();

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: connector,
    });

    expect(tally).toMatchObject({ pushed: 1, conflicts: 1, pulled: 0 });
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'update', externalId: 'ext-conflict' }),
    ]);
    // The local title survives (Docket wins) — never overwritten by the losing remote value.
    const after = await loadTask(local.id);
    expect(after.title).toBe('Docket wins this title');
    expect(after.externalUpdatedAt?.toISOString()).toBe(NEWER_ISO); // re-anchored from the echo

    const events = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.subjectId, local.id), eq(schema.auditEvent.organizationId, orgId)),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({
      kind: 'sync_conflict',
      resolution: 'docket_wins',
      remoteTitle: 'Notion title (loses)',
      remoteBody: 'losing body',
    });
  });

  it('push without a result (e.g. delete-shaped ack) leaves the anchors untouched', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId, { writeBack: true });
    const local = await seedLinkedTask(orgId, teamId, integration.id, {
      externalId: 'ext-noresult',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'), // dirty
      externalUpdatedAt: new Date(OLD_ISO),
    });
    // Remote unchanged since the anchor -> a plain (uncontested) push, not a conflict.
    const item = remoteItem({
      id: 'ext-noresult',
      provenance: {
        provider: 'gtasks',
        externalId: 'ext-noresult',
        importedAt: NOW_ISO,
        externalUpdatedAt: OLD_ISO,
      },
    });
    const { connector } = fakeWritable(() => undefined);

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: connector,
    });

    expect(tally.pushed).toBe(1);
    const after = await loadTask(local.id);
    // Unchanged: pushUpdate returns early on an undefined result.
    expect(after.externalUpdatedAt?.toISOString()).toBe(OLD_ISO);
  });

  it('pushDelete: a dirty canceled local task is deleted at the provider and stamped clean', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId, { writeBack: true });
    const local = await seedLinkedTask(orgId, teamId, integration.id, {
      externalId: 'ext-del',
      externalListId: 'list-1',
      state: 'canceled',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'), // dirty
      externalUpdatedAt: new Date(OLD_ISO),
    });
    const { connector, calls } = fakeWritable();

    // No remote item for this externalId — the provider pull filtered it out.
    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: connector,
    });

    expect(tally.deleted).toBe(1);
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'delete', externalId: 'ext-del', listId: 'list-1' }),
    ]);
    const after = await loadTask(local.id);
    expect(after.externalUpdatedAt).not.toBeNull();
    expect(after.updatedAt.getTime()).toBe(after.externalUpdatedAt?.getTime());
  });

  it('archive: a remote tombstone archives the local linked task into the canceled state', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const local = await seedLinkedTask(orgId, teamId, integration.id, { externalId: 'ext-arch' });
    const item = remoteItem({
      id: 'ext-arch',
      removed: true,
      provenance: {
        provider: 'gtasks',
        externalId: 'ext-arch',
        importedAt: NOW_ISO,
        externalUpdatedAt: NEWER_ISO,
      },
    });

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: null,
    });

    expect(tally.archived).toBe(1);
    const after = await loadTask(local.id);
    expect(after.state).toBe('canceled');
    expect(after.canceledAt?.toISOString()).toBe(NEWER_ISO);
  });

  it('pushNativeCreates: pushes a brand-new native task out and converts it to linked', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId, {
      writeBack: true,
      config: { pushNativeTasks: true, defaultListId: 'list-default' },
    });
    const native = await seedNativeTask(orgId, teamId, { title: 'Brand new', state: 'done' });
    const { connector, calls } = fakeWritable(() => ({
      externalId: 'ext-created',
      externalUpdatedAt: NEWER_ISO,
      externalEtag: 'etag-created',
    }));

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: connector,
    });

    expect(tally.created).toBe(1);
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'create', listId: 'list-default', completed: true }),
    ]);
    const after = await loadTask(native.id);
    expect(after.source).toBe('linked');
    expect(after.sourceIntegrationId).toBe(integration.id);
    expect(after.externalId).toBe('ext-created');
    expect(after.externalEtag).toBe('etag-created');
  });

  it('pushNativeCreates: a push with no result leaves the native task untouched (never partially linked)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId, {
      writeBack: true,
      config: { pushNativeTasks: true, defaultListId: 'list-default' },
    });
    const native = await seedNativeTask(orgId, teamId);
    const { connector } = fakeWritable(() => undefined);

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: connector,
    });

    expect(tally.created).toBe(0);
    const after = await loadTask(native.id);
    expect(after.source).toBe('native');
    expect(after.externalId).toBeNull();
  });

  it('does not push native creates when config.pushNativeTasks is off (default)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId, { writeBack: true });
    await seedNativeTask(orgId, teamId);
    const { connector, calls } = fakeWritable();

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: connector,
    });

    expect(tally.created).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('insert: a completed remote with an assignee, dueDate, and full provenance sets every optional field', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const item = remoteItem({
      id: 'ext-full',
      title: 'Fully-specified item',
      body: 'A real body',
      completed: true,
      dueDate: '2026-08-15',
      provenance: {
        provider: 'gtasks',
        externalId: 'ext-full',
        importedAt: NOW_ISO,
        externalUpdatedAt: NEWER_ISO,
        externalUrl: 'https://tasks.google.com/ext-full',
        externalListId: 'list-full',
        externalEtag: 'etag-full',
      },
    });

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: humanActorId,
      writable: null,
    });

    expect(tally.inserted).toBe(1);
    const created = one(
      await db
        .select()
        .from(schema.task)
        .where(eq(schema.task.sourceIntegrationId, integration.id)),
    );
    expect(created.state).toBe('done'); // completed -> the team's completed-type state
    expect(created.completedAt).not.toBeNull();
    expect(created.assigneeId).toBe(humanActorId);
    expect(created.dueDate).not.toBeNull();
    expect(created.externalUrl).toBe('https://tasks.google.com/ext-full');
    expect(created.externalListId).toBe('list-full');
    expect(created.externalEtag).toBe('etag-full');
    expect(created.externalUpdatedAt?.toISOString()).toBe(NEWER_ISO);
    expect(created.updatedAt.toISOString()).toBe(NEWER_ISO); // echo guard
  });

  it('insert: a bare remote with no optional provenance/body/dueDate/assignee omits every optional field', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const item: ImportedItem = {
      id: 'ext-bare',
      kind: 'issue',
      title: 'Bare item',
      provenance: { provider: 'gtasks', externalId: 'ext-bare', importedAt: NOW_ISO },
    };

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: null,
    });

    expect(tally.inserted).toBe(1);
    const created = one(
      await db
        .select()
        .from(schema.task)
        .where(eq(schema.task.sourceIntegrationId, integration.id)),
    );
    expect(created.state).toBe('todo'); // not completed -> the team's open state
    expect(created.completedAt).toBeNull();
    expect(created.assigneeId).toBeNull();
    expect(created.dueDate).toBeNull();
    expect(created.externalUrl).toBeNull();
    expect(created.externalUpdatedAt).toBeNull(); // no anchor -> never stamped
  });

  it('insert: a completed remote with no provenance timestamp stamps completedAt from wall-clock now', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const item: ImportedItem = {
      id: 'ext-completed-no-anchor',
      kind: 'issue',
      title: 'Completed, no anchor',
      completed: true,
      provenance: {
        provider: 'gtasks',
        externalId: 'ext-completed-no-anchor',
        importedAt: NOW_ISO,
        // no externalUpdatedAt
      },
    };

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: null,
    });

    expect(tally.inserted).toBe(1);
    const created = one(
      await db
        .select()
        .from(schema.task)
        .where(eq(schema.task.sourceIntegrationId, integration.id)),
    );
    expect(created.state).toBe('done');
    expect(created.completedAt).not.toBeNull(); // anchor ?? new Date() -> stamped anyway
    expect(created.externalUpdatedAt).toBeNull(); // still no echo-guard anchor
  });

  it('pull: a remote with a fresh body and no dueDate clears the local dueDate and stays open', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const local = await seedLinkedTask(orgId, teamId, integration.id, {
      externalId: 'ext-pull-2',
      description: 'stale body',
      dueDate: new Date('2026-01-01'),
    });
    const item: ImportedItem = {
      id: 'ext-pull-2',
      kind: 'issue',
      title: 'Pulled',
      body: 'fresh body',
      // no dueDate, no completed
      provenance: {
        provider: 'gtasks',
        externalId: 'ext-pull-2',
        importedAt: NOW_ISO,
        externalUpdatedAt: NEWER_ISO,
      },
    };

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: null,
    });

    expect(tally.pulled).toBe(1);
    const after = await loadTask(local.id);
    expect(after.description).toBe('fresh body');
    expect(after.dueDate).toBeNull();
    expect(after.state).toBe('todo');
    expect(after.completedAt).toBeNull();
    expect(after.externalUpdatedAt?.toISOString()).toBe(NEWER_ISO);
  });

  it('pull: a remote with no body clears the local description to null', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const local = await seedLinkedTask(orgId, teamId, integration.id, {
      externalId: 'ext-pull-nobody',
      description: 'stale body',
    });
    const item: ImportedItem = {
      id: 'ext-pull-nobody',
      kind: 'issue',
      title: 'Pulled, no body',
      // no body
      provenance: {
        provider: 'gtasks',
        externalId: 'ext-pull-nobody',
        importedAt: NOW_ISO,
        externalUpdatedAt: NEWER_ISO,
      },
    };

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: null,
    });

    expect(tally.pulled).toBe(1);
    const after = await loadTask(local.id);
    expect(after.description).toBeNull();
  });

  it('push: a dirty local task with a dueDate and an etag includes both in the push op', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId, { writeBack: true });
    await seedLinkedTask(orgId, teamId, integration.id, {
      externalId: 'ext-push-fields',
      externalEtag: 'etag-push',
      dueDate: new Date('2026-09-01'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      externalUpdatedAt: new Date(OLD_ISO),
    });
    const item = remoteItem({
      id: 'ext-push-fields',
      provenance: {
        provider: 'gtasks',
        externalId: 'ext-push-fields',
        importedAt: NOW_ISO,
        externalUpdatedAt: OLD_ISO,
      },
    });
    const { connector, calls } = fakeWritable();

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: connector,
    });

    expect(tally.pushed).toBe(1);
    expect(calls).toEqual([
      expect.objectContaining({
        kind: 'update',
        etag: 'etag-push',
        dueDate: '2026-09-01T00:00:00.000Z',
      }),
    ]);
  });

  it('pushDelete: falls back to the task id as connectionId and "@default" as listId when externalListId is unset', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId, { writeBack: true });
    await seedLinkedTask(orgId, teamId, integration.id, {
      externalId: 'ext-del-2',
      externalListId: null,
      state: 'canceled',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      externalUpdatedAt: new Date(OLD_ISO),
    });
    const { connector, calls } = fakeWritable();

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: connector,
    });

    expect(tally.deleted).toBe(1);
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'delete', externalId: 'ext-del-2', listId: '@default' }),
    ]);
  });

  it('archive: a remote tombstone with no externalUpdatedAt anchors the archive to now', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const local = await seedLinkedTask(orgId, teamId, integration.id, { externalId: 'ext-arch-2' });
    const item: ImportedItem = {
      id: 'ext-arch-2',
      kind: 'issue',
      title: 'Tombstoned, no anchor',
      removed: true,
      provenance: { provider: 'gtasks', externalId: 'ext-arch-2', importedAt: NOW_ISO },
    };

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: null,
    });

    expect(tally.archived).toBe(1);
    const after = await loadTask(local.id);
    expect(after.state).toBe('canceled');
    expect(after.canceledAt).not.toBeNull();
  });

  it('pushNativeCreates: a task with a dueDate pushes it, and a result with no etag clears externalEtag to null', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId, {
      writeBack: true,
      config: { pushNativeTasks: true, defaultListId: 'list-default' },
    });
    const native = await seedNativeTask(orgId, teamId, { dueDate: new Date('2026-10-01') });
    const { connector, calls } = fakeWritable(() => ({
      externalId: 'ext-created-2',
      externalUpdatedAt: NEWER_ISO,
      // no externalEtag in the result
    }));

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: connector,
    });

    expect(tally.created).toBe(1);
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'create', dueDate: '2026-10-01T00:00:00.000Z' }),
    ]);
    const after = await loadTask(native.id);
    expect(after.externalEtag).toBeNull();
  });
});

describe('resolveStateKeys — fallback chains on a team with an incomplete workflow-state list', () => {
  /** A team whose only state has type 'started' — none of unstarted/completed/canceled exist. */
  const oddStates = [
    { key: 'in-flight', name: 'In Flight', type: 'started' as const, position: 0 },
  ];

  async function seedOddTeam() {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const oddTeam = one(
      await db
        .insert(schema.team)
        .values({ organizationId: orgId, name: 'Odd', key: 'ODD', workflowStates: oddStates })
        .returning(),
    );
    // The team keeps its own Task statuses, and its set is the incomplete one above: a single
    // 'started' status, with no unstarted/completed/canceled entry for the resolver to land on.
    for (const seed of oddStates) {
      await seedStatus(db, schema, {
        organizationId: orgId,
        entityType: 'task',
        teamId: oddTeam.id,
        key: seed.key,
        name: seed.name,
        description: null,
        category: 'started',
        position: seed.position,
      });
    }
    return { orgId, teamId: oddTeam.id, humanActorId };
  }

  it('falls back to the first state for openKey/completedKey, and to completedKey for canceledKey', async () => {
    const { orgId, teamId, humanActorId } = await seedOddTeam();
    const integration = await seedIntegration(orgId, humanActorId);
    const item = remoteItem({
      id: 'ext-odd',
      provenance: { provider: 'gtasks', externalId: 'ext-odd', importedAt: NOW_ISO },
    });

    await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: null,
    });

    const created = one(
      await db
        .select()
        .from(schema.task)
        .where(eq(schema.task.sourceIntegrationId, integration.id)),
    );
    // openKey falls back to states[0].key ('unstarted' type absent).
    expect(created.state).toBe('in-flight');
  });

  it("typeOf falls back to 'backlog' for a task state key the team no longer defines", async () => {
    const { orgId, teamId, humanActorId } = await seedOddTeam();
    const integration = await seedIntegration(orgId, humanActorId, { writeBack: true });
    // A dirty task whose `state` predates a workflow-state rename — no longer a key in this
    // team's own set. A remote counterpart (unchanged since the anchor) keeps the action a plain
    // 'push', not 'pushDelete' or 'noop', so `pushUpdate`'s `stateType === 'completed'` check is
    // what's actually exercised by the `typeOf(...) ?? 'backlog'` fallback.
    await seedStatus(db, schema, {
      organizationId: orgId,
      entityType: 'task',
      teamId: null,
      key: 'a-deleted-state-key',
      name: 'A Deleted State Key',
      description: null,
      category: 'started',
      position: 1,
    });
    await seedLinkedTask(orgId, teamId, integration.id, {
      externalId: 'ext-stale-key',
      state: 'a-deleted-state-key',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      externalUpdatedAt: new Date(OLD_ISO),
    });
    const item = remoteItem({
      id: 'ext-stale-key',
      provenance: {
        provider: 'gtasks',
        externalId: 'ext-stale-key',
        importedAt: NOW_ISO,
        externalUpdatedAt: OLD_ISO,
      },
    });
    const { connector, calls } = fakeWritable();

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: connector,
    });

    // typeOf(...) ?? 'backlog' -> stateType 'backlog', not 'completed' -> completed: false.
    expect(tally.pushed).toBe(1);
    expect(calls).toEqual([expect.objectContaining({ completed: false })]);
  });

  it('falls all the way through to the literal backlog/done defaults on a team with an EMPTY workflow-state list', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const emptyTeam = one(
      await db
        .insert(schema.team)
        .values({ organizationId: orgId, name: 'Empty', key: 'EMPTY', workflowStates: [] })
        .returning(),
    );
    // The team's own set is as degenerate as a set can be: one status, in the category new work
    // starts in, and nothing else for the resolver to prefer.
    await seedStatus(db, schema, {
      organizationId: orgId,
      entityType: 'task',
      teamId: emptyTeam.id,
      key: 'backlog',
      name: 'Backlog',
      description: null,
      category: 'backlog',
      position: 0,
    });
    const integration = await seedIntegration(orgId, humanActorId);
    const item = remoteItem({
      id: 'ext-empty-states',
      provenance: { provider: 'gtasks', externalId: 'ext-empty-states', importedAt: NOW_ISO },
    });

    await reconcileTasks(orgId, humanActorId, integration, emptyTeam.id, [item], {
      assigneeId: null,
      writable: null,
    });

    const created = one(
      await db
        .select()
        .from(schema.task)
        .where(eq(schema.task.sourceIntegrationId, integration.id)),
    );
    // No unstarted status to land on, and none in the same half either, so the fallback settles
    // on the only status the set has.
    expect(created.state).toBe('backlog');
  });
});

describe('reconcileTasks — a stored config that fails ConnectorConfig validation', () => {
  it('falls back to an empty config rather than throwing, silently skipping pushNativeCreates', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    // Seeded directly (bypassing the API's own `validateTeamMappings`/zod body validation), so
    // this shape — invalid per `ConnectorConfig` — can actually reach `reconcileTasks` at all.
    const integration = await seedIntegration(orgId, humanActorId, {
      writeBack: true,
      config: { pushNativeTasks: 'not-a-boolean', defaultListId: 42 },
    });
    await seedNativeTask(orgId, teamId);
    const { connector, calls } = fakeWritable();

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: connector,
    });

    // ConnectorConfig.safeParse(...).data ?? {} -> pushNativeTasks/defaultListId both absent ->
    // the pushNativeCreates phase's guard (`config.pushNativeTasks && config.defaultListId`)
    // never fires, even though a native task exists.
    expect(tally.created).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
