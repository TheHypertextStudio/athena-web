/**
 * `@docket/api` — reconciling linked Notion database rows, with their page bodies.
 *
 * @remarks
 * Notion's import returns only rows changed since the last read, so an unchanged row is absent
 * from it. These cases pin that Docket edits to such rows still go out, that a page body Docket
 * could not read or write is never treated as empty, and that a row Notion no longer serves does
 * not stop the rest of the sync.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { ConnectorError, type ImportedItem, type WritableConnector } from '@docket/integrations';

import type * as PlanModule from '../../src/routes/integration-reconcile-plan';
import type * as ReconcileModule from '../../src/routes/integration-reconcile';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let planTaskReconcile!: typeof PlanModule.planTaskReconcile;
let reconcileTasks!: typeof ReconcileModule.reconcileTasks;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  planTaskReconcile = (await import('../../src/routes/integration-reconcile-plan'))
    .planTaskReconcile;
  reconcileTasks = (await import('../../src/routes/integration-reconcile')).reconcileTasks;
});

/** A dirty local linked task: edited in Docket after the last synced anchor. */
function dirtyLocal(
  over: Partial<PlanModule.ReconcileLocalTask> = {},
): PlanModule.ReconcileLocalTask {
  return {
    id: 't1',
    title: 'Local title',
    description: null,
    state: 'todo',
    stateType: 'unstarted',
    dueDate: null,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    externalId: 'page-1',
    externalUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    externalEtag: null,
    externalListId: 'notion-data-source-1',
    externalBodyHash: null,
    ...over,
  };
}

describe('planTaskReconcile — rows absent from a changed-rows-only read', () => {
  it('pushes a dirty local edit whose remote is absent', () => {
    expect(
      planTaskReconcile(dirtyLocal(), undefined, { writeBack: true, absentIsUnchanged: true }),
    ).toEqual({ kind: 'push' });
  });

  it('leaves an absent remote alone when the read was complete or write-back is off', () => {
    expect(
      planTaskReconcile(dirtyLocal(), undefined, { writeBack: true, absentIsUnchanged: false }),
    ).toEqual({ kind: 'noop' });
    expect(
      planTaskReconcile(dirtyLocal(), undefined, { writeBack: false, absentIsUnchanged: true }),
    ).toEqual({ kind: 'noop' });
  });

  it('does not push a clean local task whose remote is absent', () => {
    const clean = dirtyLocal({ updatedAt: new Date('2026-01-01T00:00:00.000Z') });
    expect(
      planTaskReconcile(clean, undefined, { writeBack: true, absentIsUnchanged: true }),
    ).toEqual({ kind: 'noop' });
  });
});

describe('reconcileTasks — linked Notion rows', () => {
  async function seedNotionTask(over: Partial<typeof DbModule.task.$inferInsert> = {}) {
    const base = await seedBaseOrg(db, schema);
    const integration = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: base.orgId,
          provider: 'notion',
          pattern: 'connector',
          roles: ['work'],
          writeBack: true,
          config: { listIds: ['notion-data-source-1'] },
          createdBy: base.humanActorId,
        })
        .returning(),
    );
    const row = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: base.orgId,
          teamId: base.teamId,
          title: 'Plan the launch',
          description: '# Launch\n\nFull brief body.',
          state: 'todo',
          statusId: base.statusId('task', 'todo'),
          source: 'linked',
          sourceIntegrationId: integration.id,
          sourceSyncMode: 'mirror',
          externalId: 'notion-page-body',
          externalListId: 'notion-data-source-1',
          externalUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-02-01T00:00:00.000Z'),
          ...over,
        })
        .returning(),
    );
    return { ...base, integration, row };
  }

  function recordingWritable(pushCalls: unknown[]): WritableConnector {
    return {
      pushTask: async (input) => {
        pushCalls.push(input);
        return { externalId: 'notion-page-body', externalUpdatedAt: '2026-02-02T00:00:00.000Z' };
      },
    };
  }

  async function taskAfter(id: string) {
    return one(await db.select().from(schema.task).where(eq(schema.task.id, id)));
  }

  it('pushes a description edit whose Notion row is absent from a changed-rows-only read', async () => {
    const { orgId, teamId, humanActorId, integration, row } = await seedNotionTask();
    const pushCalls: unknown[] = [];

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: recordingWritable(pushCalls),
      readChangedOnly: true,
    });

    expect(tally).toMatchObject({ pushed: 1, conflicts: 0 });
    expect(pushCalls).toEqual([
      expect.objectContaining({
        op: expect.objectContaining({
          kind: 'update',
          externalId: 'notion-page-body',
          notes: row.description,
        }),
      }),
    ]);
    const after = await taskAfter(row.id);
    expect(after.externalUpdatedAt?.toISOString()).toBe('2026-02-02T00:00:00.000Z');
    expect(after.updatedAt.getTime()).toBe(after.externalUpdatedAt?.getTime());
  });

  it('leaves a task from a database outside the selected lists alone', async () => {
    const { orgId, teamId, humanActorId, integration } = await seedNotionTask({
      externalListId: 'notion-data-source-deselected',
    });
    const pushCalls: unknown[] = [];

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: recordingWritable(pushCalls),
      readChangedOnly: true,
    });

    expect(tally.pushed).toBe(0);
    expect(pushCalls).toEqual([]);
  });

  it('skips an absent row Notion no longer serves and keeps syncing the rest', async () => {
    const { orgId, teamId, humanActorId, integration, row } = await seedNotionTask();

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: {
        pushTask: async () => {
          throw new ConnectorError('gone', { provider: 'notion', kind: 'provider', status: 404 });
        },
      },
      readChangedOnly: true,
    });

    expect(tally.pushed).toBe(0);
    expect((await taskAfter(row.id)).updatedAt).toEqual(row.updatedAt);
  });

  it('keeps a task whose page content Notion refused due for another push', async () => {
    const { orgId, teamId, humanActorId, integration, row } = await seedNotionTask();

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: {
        pushTask: async () => ({
          externalId: 'notion-page-body',
          externalUpdatedAt: '2026-02-02T00:00:00.000Z',
          contentState: 'inaccessible',
        }),
      },
      readChangedOnly: true,
    });

    expect(tally).toMatchObject({ pushed: 1, contentInaccessible: 1 });
    const after = await taskAfter(row.id);
    expect(after.updatedAt.getTime()).toBeGreaterThan(after.externalUpdatedAt?.getTime() ?? 0);
  });

  it('counts a page Notion would not replace and leaves the task clean', async () => {
    const { orgId, teamId, humanActorId, integration, row } = await seedNotionTask();

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: {
        pushTask: async () => ({
          externalId: 'notion-page-body',
          externalUpdatedAt: '2026-02-02T00:00:00.000Z',
          contentState: 'rejected',
        }),
      },
      readChangedOnly: true,
    });

    expect(tally).toMatchObject({ pushed: 1, contentRejected: 1 });
    const after = await taskAfter(row.id);
    expect(after.updatedAt.getTime()).toBe(after.externalUpdatedAt?.getTime());
    expect(after.externalBodyHash).toBeNull();
  });

  it('pushes a title edit without the page body Docket could only read in part', async () => {
    const { orgId, teamId, humanActorId, integration, row } = await seedNotionTask({
      description: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const truncated: ImportedItem = {
      id: 'notion-page-body',
      kind: 'issue',
      title: 'Plan the launch',
      body: 'Clipped Description property',
      bodyUnavailable: true,
      provenance: {
        provider: 'notion',
        externalId: 'notion-page-body',
        externalListId: 'notion-data-source-1',
        importedAt: '2026-03-01T00:00:00.000Z',
        externalUpdatedAt: '2026-03-01T00:00:00.000Z',
      },
    };
    await reconcileTasks(orgId, humanActorId, integration, teamId, [truncated], {
      assigneeId: null,
      writable: null,
    });
    await db
      .update(schema.task)
      .set({ title: 'Plan the launch party' })
      .where(eq(schema.task.id, row.id));
    const pushCalls: unknown[] = [];

    await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: recordingWritable(pushCalls),
      readChangedOnly: true,
    });
    await db
      .update(schema.task)
      .set({ description: 'Written in Docket' })
      .where(eq(schema.task.id, row.id));
    await reconcileTasks(orgId, humanActorId, integration, teamId, [], {
      assigneeId: null,
      writable: recordingWritable(pushCalls),
      readChangedOnly: true,
    });

    expect(pushCalls).toEqual([
      expect.objectContaining({
        op: expect.objectContaining({ title: 'Plan the launch party', notesUnchanged: true }),
      }),
      expect.objectContaining({
        op: expect.not.objectContaining({ notesUnchanged: true }),
      }),
    ]);
  });

  it('keeps the local description when a newer Notion row arrives without a readable body', async () => {
    const { orgId, teamId, humanActorId, integration, row } = await seedNotionTask({
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const item: ImportedItem = {
      id: 'notion-page-body',
      kind: 'issue',
      title: 'Plan the launch (renamed in Notion)',
      body: 'Clipped Description property',
      bodyUnavailable: true,
      provenance: {
        provider: 'notion',
        externalId: 'notion-page-body',
        externalListId: 'notion-data-source-1',
        importedAt: '2026-03-01T00:00:00.000Z',
        externalUpdatedAt: '2026-03-01T00:00:00.000Z',
      },
    };

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [item], {
      assigneeId: null,
      writable: null,
    });

    expect(tally.pulled).toBe(1);
    const after = await taskAfter(row.id);
    expect(after.title).toBe(item.title);
    expect(after.description).toBe(row.description);
  });
});
