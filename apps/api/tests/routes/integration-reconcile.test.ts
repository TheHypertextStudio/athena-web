import { beforeAll, describe, expect, it } from 'vitest';

import type { ImportedItem } from '@docket/boundaries';

import type * as ReconcileModule from '../../src/routes/integration-reconcile';
import { getDb } from './harness.test';

// `planTaskReconcile` is pure, but its module imports `@docket/db`, so we defer the import
// until the harness has configured the (pglite) DATABASE_URL — exactly like the other suites.
let planTaskReconcile!: typeof ReconcileModule.planTaskReconcile;
type Local = ReconcileModule.ReconcileLocalTask;

beforeAll(async () => {
  await getDb();
  planTaskReconcile = (await import('../../src/routes/integration-reconcile')).planTaskReconcile;
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

  it('resolves a both-sides-changed conflict by newest timestamp (local wins)', () => {
    const l = local({ updatedAt: D('2026-03-01T00:00:00.000Z') }); // dirty + newest
    const r = remote({ externalUpdatedAt: '2026-02-01T00:00:00.000Z' }); // newer than anchor
    expect(planTaskReconcile(l, r, { writeBack: true })).toEqual({ kind: 'push' });
  });

  it('resolves a both-sides-changed conflict by newest timestamp (remote wins)', () => {
    const l = local({ updatedAt: D('2026-02-01T00:00:00.000Z') }); // dirty
    const r = remote({ externalUpdatedAt: '2026-03-01T00:00:00.000Z' }); // newest
    expect(planTaskReconcile(l, r, { writeBack: true })).toEqual({ kind: 'pull' });
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
