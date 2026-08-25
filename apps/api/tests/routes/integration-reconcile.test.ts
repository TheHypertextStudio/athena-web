import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ExternalWriteResult, ImportedItem, WritableConnector } from '@docket/integrations';

import type * as ReconcileModule from '../../src/routes/integration-reconcile';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

// `planTaskReconcile` is pure, but its module imports `@docket/db`, so we defer the import
// until the harness has configured the (pglite) DATABASE_URL — exactly like the other suites.
let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let planTaskReconcile!: typeof ReconcileModule.planTaskReconcile;
let reconcileTasks!: typeof ReconcileModule.reconcileTasks;
type Local = ReconcileModule.ReconcileLocalTask;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/integration-reconcile');
  planTaskReconcile = mod.planTaskReconcile;
  reconcileTasks = mod.reconcileTasks;
});

const D = (iso: string): Date => new Date(iso);

/** A live local linked task; override fields per case. */
function local(over: Partial<Local> = {}): Local {
  return {
    id: 't1',
    title: 'Local title',
    description: null,
    state: 'todo',
    stateType: 'unstarted',
    dueDate: null,
    updatedAt: D('2026-01-01T00:00:00.000Z'),
    externalId: 'gt1',
    externalUpdatedAt: D('2026-01-01T00:00:00.000Z'),
    externalEtag: 'etag1',
    externalListId: '@default',
    ...over,
  };
}

/** A pulled remote item; override fields per case. */
function remote(over: Partial<ImportedItem> & { externalUpdatedAt?: string } = {}): ImportedItem {
  const { externalUpdatedAt, ...rest } = over;
  return {
    id: 'gt1',
    kind: 'issue',
    title: 'Remote title',
    provenance: {
      provider: 'gtasks',
      externalId: 'gt1',
      importedAt: '2026-01-01T00:00:00.000Z',
      ...(externalUpdatedAt ? { externalUpdatedAt } : {}),
    },
    ...rest,
  };
}

describe('planTaskReconcile', () => {
  it('inserts a remote item we have no local counterpart for', () => {
    expect(planTaskReconcile(undefined, remote(), { writeBack: true })).toEqual({ kind: 'insert' });
  });

  it('ignores a tombstone for an item we never had', () => {
    expect(planTaskReconcile(undefined, remote({ removed: true }), { writeBack: true })).toEqual({
      kind: 'noop',
    });
  });

  it('never archives on mere absence — a list-filtered task is left alone', () => {
    expect(planTaskReconcile(local(), undefined, { writeBack: true })).toEqual({ kind: 'noop' });
  });

  it('pushes a delete when a local task was canceled and is dirty', () => {
    const l = local({
      stateType: 'canceled',
      state: 'canceled',
      updatedAt: D('2026-01-02T00:00:00.000Z'), // > anchor ⇒ dirty
    });
    expect(planTaskReconcile(l, undefined, { writeBack: true })).toEqual({ kind: 'pushDelete' });
    // ...but only with write-back enabled.
    expect(planTaskReconcile(l, undefined, { writeBack: false })).toEqual({ kind: 'noop' });
  });

  it('archives the local task when the remote is a tombstone', () => {
    expect(planTaskReconcile(local(), remote({ removed: true }), { writeBack: true })).toEqual({
      kind: 'archive',
    });
  });

  it('pushes a dirty local edit when the remote has not changed', () => {
    const l = local({ updatedAt: D('2026-01-02T00:00:00.000Z') }); // dirty, anchor at Jan 1
    const r = remote({ externalUpdatedAt: '2026-01-01T00:00:00.000Z' }); // == anchor ⇒ not newer
    expect(planTaskReconcile(l, r, { writeBack: true })).toEqual({ kind: 'push' });
  });

  it('pulls a newer remote onto a clean local task', () => {
    const r = remote({ externalUpdatedAt: '2026-02-01T00:00:00.000Z' });
    expect(planTaskReconcile(local(), r, { writeBack: true })).toEqual({ kind: 'pull' });
  });

  it('resolves a both-sides-changed conflict in Docket’s favour when Docket is also newer', () => {
    const l = local({ updatedAt: D('2026-03-01T00:00:00.000Z') }); // dirty + newest
    const r = remote({ externalUpdatedAt: '2026-02-01T00:00:00.000Z' }); // newer than anchor
    const action = planTaskReconcile(l, r, { writeBack: true });
    expect(action.kind).toBe('push');
  });

  it('resolves a both-sides-changed conflict in Docket’s favour EVEN when the remote is newer', () => {
    const l = local({ updatedAt: D('2026-02-01T00:00:00.000Z') }); // dirty, older
    const r = remote({ externalUpdatedAt: '2026-03-01T00:00:00.000Z' }); // newer — used to win
    expect(planTaskReconcile(l, r, { writeBack: true })).toMatchObject({ kind: 'push' });
  });

  it('reports the losing remote values on the conflict so they can be logged, not dropped', () => {
    const l = local({ updatedAt: D('2026-02-01T00:00:00.000Z') });
    const r = remote({
      externalUpdatedAt: '2026-03-01T00:00:00.000Z',
      title: 'Notion’s title',
      body: 'Notion’s notes',
      dueDate: '2026-04-01',
      completed: true,
    });
    const action = planTaskReconcile(l, r, { writeBack: true });
    expect(action).toEqual({
      kind: 'push',
      conflict: {
        externalId: 'gt1',
        remoteUpdatedAt: '2026-03-01T00:00:00.000Z',
        localUpdatedAt: '2026-02-01T00:00:00.000Z',
        remoteTitle: 'Notion’s title',
        remoteBody: 'Notion’s notes',
        remoteDueDate: '2026-04-01',
        remoteCompleted: true,
      },
    });
  });

  it('an uncontested push carries NO conflict — only a genuine two-sided edit does', () => {
    const l = local({ updatedAt: D('2026-02-01T00:00:00.000Z') }); // dirty
    const r = remote({ externalUpdatedAt: '2026-01-01T00:00:00.000Z' }); // == anchor, unchanged
    expect(planTaskReconcile(l, r, { writeBack: true })).toEqual({ kind: 'push' });
  });

  it('a one-sided remote change is not a conflict — a clean Docket task still learns', () => {
    const r = remote({ externalUpdatedAt: '2026-03-01T00:00:00.000Z' });
    expect(planTaskReconcile(local(), r, { writeBack: true })).toEqual({ kind: 'pull' });
  });

  it('a read-only mirror never pushes — a dirty local yields to a newer remote', () => {
    const l = local({ updatedAt: D('2026-02-01T00:00:00.000Z') });
    const r = remote({ externalUpdatedAt: '2026-03-01T00:00:00.000Z' });
    expect(planTaskReconcile(l, r, { writeBack: false })).toEqual({ kind: 'pull' });
  });

  it('a read-only mirror leaves a dirty local alone when the remote has not changed', () => {
    const l = local({ updatedAt: D('2026-02-01T00:00:00.000Z') });
    const r = remote({ externalUpdatedAt: '2026-01-01T00:00:00.000Z' });
    expect(planTaskReconcile(l, r, { writeBack: false })).toEqual({ kind: 'noop' });
  });

  it('no-ops when neither side changed since the last sync', () => {
    const r = remote({ externalUpdatedAt: '2026-01-01T00:00:00.000Z' }); // == anchor
    expect(planTaskReconcile(local(), r, { writeBack: true })).toEqual({ kind: 'noop' });
  });

  it('no-ops on a clean local when the provider reports no per-item update timestamp at all', () => {
    // Some providers never populate `externalUpdatedAt` — remoteMs is undefined, so remoteNewer
    // can never be true regardless of the anchor, and a clean local simply stays put.
    const r = remote(); // no externalUpdatedAt override
    expect(planTaskReconcile(local(), r, { writeBack: true })).toEqual({ kind: 'noop' });
  });

  it('prefers a delete over an update when a dirty local task is canceled', () => {
    const l = local({
      stateType: 'canceled',
      state: 'canceled',
      updatedAt: D('2026-02-01T00:00:00.000Z'),
    });
    const r = remote({ externalUpdatedAt: '2026-01-01T00:00:00.000Z' });
    expect(planTaskReconcile(l, r, { writeBack: true })).toEqual({ kind: 'pushDelete' });
  });
});

/**
 * `reconcileTasks` end-to-end for `provider: 'notion'` specifically — proving that when the same
 * field is edited on both sides, Docket's value wins the conflict.
 *
 * @remarks
 * The pure `planTaskReconcile` cases above are provider-agnostic by design — the decision logic
 * never reads `provenance.provider`. The conflict-resolution guarantee ("Docket wins, and the
 * outbound write carries Docket's value") is only observable at the `reconcileTasks` orchestration
 * level, against a real integration row and a scripted `pushTask`. `integration-reconcile-orchestration
 * .test.ts` already covers this shape generically with `provider: 'gtasks'`; this block closes the
 * one thing that leaves — that the exact same guarantee holds with `provider: 'notion'`, and that
 * the conflict log records Notion specifically, not a generic provider string.
 */
describe('reconcileTasks — the Notion connector (Docket wins conflicts, the loss is logged)', () => {
  it('pushes Docket’s value to Notion and records Notion’s losing value under provider: notion', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const integration = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'notion',
          pattern: 'connector',
          roles: ['work'],
          writeBack: true,
          createdBy: humanActorId,
        })
        .returning(),
    );
    const local = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Docket’s title wins',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          source: 'linked',
          sourceIntegrationId: integration.id,
          sourceSyncMode: 'mirror',
          externalId: 'notion-page-conflict',
          externalListId: 'notion-data-source-1',
          externalUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          // Dirty: edited locally after the last synced anchor.
          updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        })
        .returning(),
    );
    const notionItem: ImportedItem = {
      id: 'notion-page-conflict',
      kind: 'issue',
      title: 'Notion’s title (loses)',
      body: 'Notion’s notes (loses)',
      provenance: {
        provider: 'notion',
        externalId: 'notion-page-conflict',
        importedAt: '2026-06-01T00:00:00.000Z',
        // Newer than the anchor — a genuine two-sided edit, not a one-sided remote change.
        externalUpdatedAt: '2026-03-01T00:00:00.000Z',
      },
    };
    const pushCalls: unknown[] = [];
    const writable: WritableConnector = {
      pushTask: async (input) => {
        pushCalls.push(input);
        const result: ExternalWriteResult = {
          externalId: 'notion-page-conflict',
          externalUpdatedAt: '2026-03-02T00:00:00.000Z',
        };
        return result;
      },
    };

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [notionItem], {
      assigneeId: null,
      writable,
    });

    expect(tally).toMatchObject({ pushed: 1, conflicts: 1, pulled: 0 });

    // The outbound push carries DOCKET's value, not Notion's losing one.
    expect(pushCalls).toEqual([
      expect.objectContaining({
        provider: 'notion',
        op: expect.objectContaining({
          kind: 'update',
          externalId: 'notion-page-conflict',
          title: 'Docket’s title wins',
        }),
      }),
    ]);

    // Docket's own row is untouched by Notion's losing title.
    const after = one(await db.select().from(schema.task).where(eq(schema.task.id, local.id)));
    expect(after.title).toBe('Docket’s title wins');

    // The loss is recorded — provider: 'notion' specifically — not silently dropped.
    const events = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.subjectId, local.id), eq(schema.auditEvent.organizationId, orgId)),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({
      kind: 'sync_conflict',
      provider: 'notion',
      integrationId: integration.id,
      resolution: 'docket_wins',
      externalId: 'notion-page-conflict',
      remoteTitle: 'Notion’s title (loses)',
      remoteBody: 'Notion’s notes (loses)',
    });
  });
});

/**
 * The shared-contract fields every connector adapter can now carry (the closure of
 * `docs/migration/sunsama-to-docket.md` §5.3): `startDate`, `estimateMinutes`, and
 * `parentExternalId`, deliberately exercised here with a generic provider rather than Sunsama —
 * the point of putting them on `ImportedItem` is that they are not Sunsama-isms.
 */
describe('reconcileTasks — startDate, estimateMinutes, and parent linkage on the shared contract', () => {
  /** Seed a plain read-only connector integration to reconcile into. */
  async function seedIntegration(orgId: string, actorId: string) {
    return one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'gtasks',
          pattern: 'connector',
          roles: ['work'],
          createdBy: actorId,
        })
        .returning(),
    );
  }

  it('persists startDate and estimateMinutes on insert, including a zero-minute estimate', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const tally = await reconcileTasks(
      orgId,
      humanActorId,
      integration,
      teamId,
      [
        remote({
          id: 'planned-1',
          startDate: '2026-08-03',
          estimateMinutes: 0,
          provenance: {
            provider: 'gtasks',
            externalId: 'planned-1',
            importedAt: '2026-08-01T00:00:00.000Z',
            externalUpdatedAt: '2026-08-01T00:00:00.000Z',
          },
        }),
      ],
      { assigneeId: null, writable: null },
    );
    expect(tally.inserted).toBe(1);

    const row = one(
      await db.select().from(schema.task).where(eq(schema.task.externalId, 'planned-1')),
    );
    expect(row.startDate?.toISOString().slice(0, 10)).toBe('2026-08-03');
    expect(row.estimateMinutes).toBe(0); // zero is a real estimate, not "unset"
    expect(row.parentTaskId).toBeNull();
  });

  it('links a child to its parent even when the child precedes the parent in the batch', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const child = remote({
      id: 'child-1',
      title: 'The child',
      parentExternalId: 'parent-1',
      provenance: {
        provider: 'gtasks',
        externalId: 'child-1',
        importedAt: '2026-08-01T00:00:00.000Z',
      },
    });
    const parent = remote({
      id: 'parent-1',
      title: 'The parent',
      provenance: {
        provider: 'gtasks',
        externalId: 'parent-1',
        importedAt: '2026-08-01T00:00:00.000Z',
      },
    });

    // Child FIRST: the depth ordering inside reconcileTasks must still insert the parent first.
    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [child, parent], {
      assigneeId: null,
      writable: null,
    });
    expect(tally.inserted).toBe(2);

    const parentRow = one(
      await db.select().from(schema.task).where(eq(schema.task.externalId, 'parent-1')),
    );
    const childRow = one(
      await db.select().from(schema.task).where(eq(schema.task.externalId, 'child-1')),
    );
    expect(childRow.parentTaskId).toBe(parentRow.id);
    expect(parentRow.parentTaskId).toBeNull();
  });

  it('reopens an auto-completed parent when the provider adds an active child', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const parent = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Finished parent',
          state: 'done',
          statusId: statusId('task', 'done'),
          completedAt: new Date('2026-08-01T00:00:00.000Z'),
          autoCompletedBySubtasks: true,
          source: 'linked',
          sourceIntegrationId: integration.id,
          sourceSyncMode: 'mirror',
          externalId: 'parent-1',
          externalUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          createdBy: humanActorId,
        })
        .returning(),
    );

    await reconcileTasks(
      orgId,
      humanActorId,
      integration,
      teamId,
      [
        remote({
          id: 'child-1',
          title: 'New active child',
          parentExternalId: 'parent-1',
          provenance: {
            provider: 'gtasks',
            externalId: 'child-1',
            importedAt: '2026-08-02T00:00:00.000Z',
          },
        }),
      ],
      { assigneeId: null, writable: null },
    );

    const reopened = one(
      await db
        .select({
          state: schema.task.state,
          completedAt: schema.task.completedAt,
          autoCompletedBySubtasks: schema.task.autoCompletedBySubtasks,
        })
        .from(schema.task)
        .where(eq(schema.task.id, parent.id)),
    );
    expect(reopened).toEqual({
      state: 'backlog',
      completedAt: null,
      autoCompletedBySubtasks: false,
    });
  });

  it('reopens a canceled child and its automatic parent through the task transition boundary', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const parent = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Finished parent',
          state: 'done',
          statusId: statusId('task', 'done'),
          completedAt: new Date('2026-08-01T00:00:00.000Z'),
          autoCompletedBySubtasks: true,
          source: 'linked',
          sourceIntegrationId: integration.id,
          sourceSyncMode: 'mirror',
          externalId: 'parent-1',
          externalUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          createdBy: humanActorId,
        })
        .returning(),
    );
    const child = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Canceled child',
          parentTaskId: parent.id,
          state: 'canceled',
          statusId: statusId('task', 'canceled'),
          canceledAt: new Date('2026-08-01T00:00:00.000Z'),
          autoCompletedBySubtasks: true,
          source: 'linked',
          sourceIntegrationId: integration.id,
          sourceSyncMode: 'mirror',
          externalId: 'child-1',
          externalUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          createdBy: humanActorId,
        })
        .returning(),
    );

    await reconcileTasks(
      orgId,
      humanActorId,
      integration,
      teamId,
      [
        remote({
          id: 'child-1',
          completed: false,
          externalUpdatedAt: '2026-08-02T00:00:00.000Z',
          provenance: {
            provider: 'gtasks',
            externalId: 'child-1',
            externalUpdatedAt: '2026-08-02T00:00:00.000Z',
            importedAt: '2026-08-02T00:00:00.000Z',
          },
        }),
      ],
      { assigneeId: null, writable: null },
    );

    const after = new Map(
      (
        await db
          .select({
            id: schema.task.id,
            state: schema.task.state,
            completedAt: schema.task.completedAt,
            canceledAt: schema.task.canceledAt,
            autoCompletedBySubtasks: schema.task.autoCompletedBySubtasks,
          })
          .from(schema.task)
          .where(eq(schema.task.organizationId, orgId))
      ).map((row) => [row.id, row]),
    );
    expect(after.get(child.id)).toMatchObject({
      state: 'todo',
      completedAt: null,
      canceledAt: null,
      autoCompletedBySubtasks: false,
    });
    expect(after.get(parent.id)).toMatchObject({
      state: 'backlog',
      completedAt: null,
      autoCompletedBySubtasks: false,
    });
  });

  it('inserts a child whose parent id resolves to nothing as top-level rather than failing', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const orphan = remote({
      id: 'orphan-1',
      parentExternalId: 'nowhere-to-be-found',
      provenance: {
        provider: 'gtasks',
        externalId: 'orphan-1',
        importedAt: '2026-08-01T00:00:00.000Z',
      },
    });
    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [orphan], {
      assigneeId: null,
      writable: null,
    });
    expect(tally.inserted).toBe(1);
    const row = one(
      await db.select().from(schema.task).where(eq(schema.task.externalId, 'orphan-1')),
    );
    expect(row.parentTaskId).toBeNull();
  });

  it('a pull without the fields leaves local startDate/estimateMinutes alone; an explicit null clears', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const localRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Locally planned',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          startDate: new Date('2026-08-10T00:00:00.000Z'),
          estimateMinutes: 25,
          source: 'linked',
          sourceIntegrationId: integration.id,
          sourceSyncMode: 'mirror',
          externalId: 'pull-1',
          externalUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'), // clean: updatedAt == anchor
        })
        .returning(),
    );

    // A provider without the concepts (both fields absent) pulls a newer title…
    await reconcileTasks(
      orgId,
      humanActorId,
      integration,
      teamId,
      [
        remote({
          id: 'pull-1',
          title: 'Renamed remotely',
          provenance: {
            provider: 'gtasks',
            externalId: 'pull-1',
            importedAt: '2026-08-01T00:00:00.000Z',
            externalUpdatedAt: '2026-02-01T00:00:00.000Z',
          },
        }),
      ],
      { assigneeId: null, writable: null },
    );
    const afterAbsent = one(
      await db.select().from(schema.task).where(eq(schema.task.id, localRow.id)),
    );
    // …and the locally-set planning fields survive untouched.
    expect(afterAbsent.title).toBe('Renamed remotely');
    expect(afterAbsent.startDate?.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(afterAbsent.estimateMinutes).toBe(25);

    // A provider that carries the concepts and says "explicitly unset" clears them.
    await reconcileTasks(
      orgId,
      humanActorId,
      integration,
      teamId,
      [
        remote({
          id: 'pull-1',
          title: 'Renamed remotely',
          startDate: null,
          estimateMinutes: null,
          provenance: {
            provider: 'gtasks',
            externalId: 'pull-1',
            importedAt: '2026-08-01T00:00:00.000Z',
            externalUpdatedAt: '2026-03-01T00:00:00.000Z',
          },
        }),
      ],
      { assigneeId: null, writable: null },
    );
    const afterNull = one(
      await db.select().from(schema.task).where(eq(schema.task.id, localRow.id)),
    );
    expect(afterNull.startDate).toBeNull();
    expect(afterNull.estimateMinutes).toBeNull();
  });

  it('refuses a re-parent that would form a cycle across runs, without failing the pull', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);

    // Run 1: insert A (top-level) and B (child of A) — a legitimate hierarchy.
    const runOne = await reconcileTasks(
      orgId,
      humanActorId,
      integration,
      teamId,
      [
        remote({
          id: 'cycle-a',
          title: 'A',
          provenance: {
            provider: 'gtasks',
            externalId: 'cycle-a',
            importedAt: '2026-08-01T00:00:00.000Z',
            externalUpdatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
        remote({
          id: 'cycle-b',
          title: 'B',
          parentExternalId: 'cycle-a',
          provenance: {
            provider: 'gtasks',
            externalId: 'cycle-b',
            importedAt: '2026-08-01T00:00:00.000Z',
            externalUpdatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      ],
      { assigneeId: null, writable: null },
    );
    expect(runOne.inserted).toBe(2);
    const aRow = one(
      await db.select().from(schema.task).where(eq(schema.task.externalId, 'cycle-a')),
    );
    const bRow = one(
      await db.select().from(schema.task).where(eq(schema.task.externalId, 'cycle-b')),
    );
    expect(bRow.parentTaskId).toBe(aRow.id);

    // Run 2: the provider now claims A is a child of B — an A→B→A loop the length-1 DB CHECK
    // cannot see. The pull must land A's other fields and drop only the parent link.
    const runTwo = await reconcileTasks(
      orgId,
      humanActorId,
      integration,
      teamId,
      [
        remote({
          id: 'cycle-a',
          title: 'A, renamed remotely',
          parentExternalId: 'cycle-b',
          provenance: {
            provider: 'gtasks',
            externalId: 'cycle-a',
            importedAt: '2026-08-02T00:00:00.000Z',
            externalUpdatedAt: '2026-02-01T00:00:00.000Z',
          },
        }),
      ],
      { assigneeId: null, writable: null },
    );
    expect(runTwo.pulled).toBe(1); // the run did not fail wholesale

    const aAfter = one(await db.select().from(schema.task).where(eq(schema.task.id, aRow.id)));
    const bAfter = one(await db.select().from(schema.task).where(eq(schema.task.id, bRow.id)));
    expect(aAfter.title).toBe('A, renamed remotely'); // the rest of the pull applied
    expect(aAfter.parentTaskId).toBeNull(); // the cycle-forming link was refused
    expect(bAfter.parentTaskId).toBe(aRow.id); // the existing hierarchy is untouched
  });

  it('a pull can update the fields and re-parent under another linked task', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const integration = await seedIntegration(orgId, humanActorId);
    const parentRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'The parent',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          source: 'linked',
          sourceIntegrationId: integration.id,
          sourceSyncMode: 'mirror',
          externalId: 'reparent-parent',
          externalUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        })
        .returning(),
    );
    const childRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Was top-level',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          source: 'linked',
          sourceIntegrationId: integration.id,
          sourceSyncMode: 'mirror',
          externalId: 'reparent-child',
          externalUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        })
        .returning(),
    );

    await reconcileTasks(
      orgId,
      humanActorId,
      integration,
      teamId,
      [
        remote({
          id: 'reparent-child',
          title: 'Now a subtask',
          startDate: '2026-09-01',
          estimateMinutes: 15,
          parentExternalId: 'reparent-parent',
          provenance: {
            provider: 'gtasks',
            externalId: 'reparent-child',
            importedAt: '2026-08-01T00:00:00.000Z',
            externalUpdatedAt: '2026-02-01T00:00:00.000Z',
          },
        }),
      ],
      { assigneeId: null, writable: null },
    );

    const after = one(await db.select().from(schema.task).where(eq(schema.task.id, childRow.id)));
    expect(after.parentTaskId).toBe(parentRow.id);
    expect(after.startDate?.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(after.estimateMinutes).toBe(15);
  });
});
