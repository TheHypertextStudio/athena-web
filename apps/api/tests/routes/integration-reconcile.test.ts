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
 * `reconcileTasks` end-to-end for `provider: 'notion'` specifically (WIL-12).
 *
 * @remarks
 * The pure `planTaskReconcile` cases above are provider-agnostic by design — the decision logic
 * never reads `provenance.provider`. What WIL-12 actually asks for ("Docket wins, and the outbound
 * write carries Docket's value") is only observable at the `reconcileTasks` orchestration level,
 * against a real integration row and a scripted `pushTask`. `integration-reconcile-orchestration
 * .test.ts` already covers this shape generically with `provider: 'gtasks'`; this block closes the
 * one thing that leaves — that the exact same guarantee holds with `provider: 'notion'`, and that
 * the conflict log records Notion specifically, not a generic provider string.
 */
describe('reconcileTasks — the Notion connector (WIL-12: Docket wins, the loss is logged)', () => {
  it('pushes Docket’s value to Notion and records Notion’s losing value under provider: notion', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
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
