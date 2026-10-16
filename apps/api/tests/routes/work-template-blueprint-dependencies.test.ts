import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { flushDeferredWork } from '../../src/lib/after-response';
import { appProvenance } from '../../src/lib/provenance/context';
import { recordChangeSetInTransaction, trackedFields } from '../../src/mcp/change-set';
import { loadBlueprintSnapshot } from '../../src/lib/work-template-blueprints/snapshot';
import { loadManagedBlueprintDependencies } from '../../src/lib/work-template-blueprints/managed-dependencies';
import {
  definition,
  fixture,
  newer,
  request,
  review,
  rows,
} from './work-template-blueprint-update-fixture';

afterEach(flushDeferredWork);
function dependent(reverse = false) {
  const value = definition(['prep', 'review']);
  value.blueprint.dependencies = [
    { blockerStepKey: reverse ? 'review' : 'prep', blockedStepKey: reverse ? 'prep' : 'review' },
  ];
  return value;
}
async function withEdge() {
  const f = await fixture(dependent());
  const blocked = (await rows(f)).find((row) => row.title === 'review');
  if (!blocked) throw new Error('Dependency fixture missing');
  return { ...f, blocked };
}

describe('selective dependency ownership', () => {
  it('removes only a selected owned edge and preserves an unrelated manual edge', async () => {
    const f = await withEdge();
    await f.schema.db
      .insert(f.schema.taskDependency)
      .values({ organizationId: f.orgId, blockingTaskId: f.root.id, blockedTaskId: f.blocked.id });
    await newer(f, undefined, undefined, definition(['prep', 'review']));
    const preview = await review(f);
    const removals = preview.childChanges.filter((change) => change.kind === 'remove_dependency');
    expect(removals).toHaveLength(1);
    expect(
      (
        await request(f, '/update', {
          workTypeId: f.published.id,
          previewToken: preview.previewToken,
          acceptChildChanges: removals.map((change) => change.changeId),
        })
      ).status,
    ).toBe(200);
    const edges = await f.schema.db
      .select()
      .from(f.schema.taskDependency)
      .where(eq(f.schema.taskDependency.organizationId, f.orgId));
    expect(edges.map((edge) => [edge.blockingTaskId, edge.blockedTaskId])).toEqual([
      [f.root.id, f.blocked.id],
    ]);
    const root = (await rows(f)).find((row) => row.id === f.root.id);
    expect(root?.blueprintState?.managedDependencies).toEqual([]);
  });

  it('accepts a reviewed reversal atomically without treating the replaced edge as a cycle', async () => {
    const f = await withEdge();
    await newer(f, undefined, undefined, dependent(true));
    const preview = await review(f);
    const changes = preview.childChanges.filter(
      (change) => change.kind === 'add_dependency' || change.kind === 'remove_dependency',
    );
    expect(changes).toHaveLength(2);
    expect(
      (
        await request(f, '/update', {
          workTypeId: f.published.id,
          previewToken: preview.previewToken,
          acceptChildChanges: changes.map((change) => change.changeId),
        })
      ).status,
    ).toBe(200);
    const edges = await f.schema.db
      .select()
      .from(f.schema.taskDependency)
      .where(eq(f.schema.taskDependency.organizationId, f.orgId));
    expect(edges.map((edge) => [edge.blockingTaskId, edge.blockedTaskId])).toEqual([
      [f.blocked.id, f.child.id],
    ]);
    expect(
      (await rows(f)).find((row) => row.id === f.root.id)?.blueprintState?.managedDependencies,
    ).toEqual([{ blockerId: f.blocked.id, blockedId: f.child.id }]);
  });

  it('does not reclaim an originally generated edge after a person removes and recreates it', async () => {
    const f = await withEdge();
    const edge = { kind: 'blocks' as const, from: f.child.id, to: f.blocked.id };
    await f.schema.db.transaction(async (tx) => {
      await tx
        .delete(f.schema.taskDependency)
        .where(
          and(
            eq(f.schema.taskDependency.blockingTaskId, edge.from),
            eq(f.schema.taskDependency.blockedTaskId, edge.to),
          ),
        );
      await recordChangeSetInTransaction(tx, {
        orgId: f.orgId,
        actorId: f.humanActorId,
        origin: { ...appProvenance(), v: 2, tool: 'manual_dependency' },
        summary: 'Removed dependency',
        changes: [{ ...edge, linked: false }],
      });
    });
    await f.schema.db.transaction(async (tx) => {
      await tx
        .insert(f.schema.taskDependency)
        .values({ organizationId: f.orgId, blockingTaskId: edge.from, blockedTaskId: edge.to });
      await recordChangeSetInTransaction(tx, {
        orgId: f.orgId,
        actorId: f.humanActorId,
        origin: { ...appProvenance(), v: 2, tool: 'manual_dependency' },
        summary: 'Added dependency',
        changes: [{ ...edge, linked: true }],
      });
    });
    await newer(f, undefined, undefined, definition(['prep', 'review']));
    const preview = await review(f);
    expect(preview.childChanges.filter((change) => change.kind === 'remove_dependency')).toEqual(
      [],
    );
  });
});

it('recovers retained dependency ownership from the original receipt and immutable authored steps', async () => {
  const f = await withEdge();
  const state = f.root.row.blueprintState;
  if (!state) throw new Error('Missing original generation metadata');
  const { managedDependencies, ...retained } = state;
  expect(managedDependencies).toEqual([{ blockerId: f.child.id, blockedId: f.blocked.id }]);
  // Older retained work predates this saved field; all original source/receipt provenance survives.
  await f.schema.db
    .update(f.schema.task)
    .set({ blueprintState: retained })
    .where(eq(f.schema.task.id, f.root.id));
  await f.schema.db.insert(f.schema.taskDependency).values({
    organizationId: f.orgId,
    blockingTaskId: f.root.id,
    blockedTaskId: f.blocked.id,
  });
  await newer(f, undefined, undefined, definition(['prep', 'review']));
  const before = await rows(f);
  const receipts = await f.schema.db
    .select()
    .from(f.schema.changeSet)
    .where(eq(f.schema.changeSet.organizationId, f.orgId))
    .orderBy(f.schema.changeSet.id);
  const preview = await review(f);
  expect(await review(f)).toEqual(preview);
  expect(await rows(f)).toEqual(before);
  expect(
    await f.schema.db
      .select()
      .from(f.schema.changeSet)
      .where(eq(f.schema.changeSet.organizationId, f.orgId))
      .orderBy(f.schema.changeSet.id),
  ).toEqual(receipts);
  const removals = preview.childChanges.filter((change) => change.kind === 'remove_dependency');
  expect(removals).toHaveLength(1);
  const accepted = await request(f, '/update', {
    workTypeId: f.published.id,
    previewToken: preview.previewToken,
    acceptChildChanges: removals.map((change) => change.changeId),
  });
  expect(accepted.status).toBe(200);
  expect(
    (
      await f.schema.db
        .select()
        .from(f.schema.taskDependency)
        .where(eq(f.schema.taskDependency.organizationId, f.orgId))
    ).map((edge) => [edge.blockingTaskId, edge.blockedTaskId]),
  ).toEqual([[f.root.id, f.blocked.id]]);
  expect(
    (await rows(f)).map((row) => ({ id: row.id, title: row.title, description: row.description })),
  ).toEqual(before.map((row) => ({ id: row.id, title: row.title, description: row.description })));
});

it('does not recover ownership of a retained edge after a person removes and recreates it', async () => {
  const f = await withEdge();
  const state = f.root.row.blueprintState;
  if (!state) throw new Error('Missing original generation metadata');
  const { managedDependencies, ...retained } = state;
  expect(managedDependencies).toHaveLength(1);
  await f.schema.db
    .update(f.schema.task)
    .set({ blueprintState: retained })
    .where(eq(f.schema.task.id, f.root.id));
  const edge = { kind: 'blocks' as const, from: f.child.id, to: f.blocked.id };
  await f.schema.db.transaction(async (tx) => {
    await tx
      .delete(f.schema.taskDependency)
      .where(
        and(
          eq(f.schema.taskDependency.blockingTaskId, edge.from),
          eq(f.schema.taskDependency.blockedTaskId, edge.to),
        ),
      );
    await recordChangeSetInTransaction(tx, {
      orgId: f.orgId,
      actorId: f.humanActorId,
      origin: { ...appProvenance(), v: 2, tool: 'manual_dependency' },
      summary: 'Removed dependency',
      changes: [{ ...edge, linked: false }],
    });
  });
  await f.schema.db.transaction(async (tx) => {
    await tx.insert(f.schema.taskDependency).values({
      organizationId: f.orgId,
      blockingTaskId: edge.from,
      blockedTaskId: edge.to,
    });
    await recordChangeSetInTransaction(tx, {
      orgId: f.orgId,
      actorId: f.humanActorId,
      origin: { ...appProvenance(), v: 2, tool: 'manual_dependency' },
      summary: 'Added dependency',
      changes: [{ ...edge, linked: true }],
    });
  });
  await newer(f, undefined, undefined, definition(['prep', 'review']));
  const before = await rows(f);
  expect(
    (await review(f)).childChanges.filter((change) => change.kind === 'remove_dependency'),
  ).toEqual([]);
  expect(await rows(f)).toEqual(before);
  expect(
    await f.schema.db
      .select()
      .from(f.schema.taskDependency)
      .where(eq(f.schema.taskDependency.organizationId, f.orgId)),
  ).toHaveLength(1);
});

it('does not invent owned edges for a retained generation whose creation recorded none', async () => {
  const f = await fixture(definition(['prep', 'review']));
  const state = f.root.row.blueprintState;
  if (!state) throw new Error('Missing original generation metadata');
  const { managedDependencies, ...retained } = state;
  expect(managedDependencies).toEqual([]);
  await f.schema.db
    .update(f.schema.task)
    .set({ blueprintState: retained })
    .where(eq(f.schema.task.id, f.root.id));
  await newer(f, undefined, undefined, definition(['prep', 'review']));
  const preview = await review(f);
  expect(preview.childChanges.filter((change) => change.kind === 'remove_dependency')).toEqual([]);
  expect(
    await f.schema.db
      .select()
      .from(f.schema.taskDependency)
      .where(eq(f.schema.taskDependency.organizationId, f.orgId)),
  ).toEqual([]);
});

it('does not convert an ordinary creation receipt into immutable template edge ownership', async () => {
  const f = await fixture();
  const manual = await f.schema.db.transaction(async (tx) => {
    const [root] = await tx
      .insert(f.schema.task)
      .values({
        organizationId: f.orgId,
        teamId: f.teamId,
        title: 'Manual parent',
        state: 'todo',
        statusId: f.statusId('task', 'todo'),
        createdBy: f.humanActorId,
      })
      .returning();
    if (!root) throw new Error('Missing manual parent');
    const [child] = await tx
      .insert(f.schema.task)
      .values({
        organizationId: f.orgId,
        teamId: f.teamId,
        parentTaskId: root.id,
        title: 'Manual child',
        state: 'todo',
        statusId: f.statusId('task', 'todo'),
        createdBy: f.humanActorId,
      })
      .returning();
    if (!child) throw new Error('Missing manual child');
    await tx.insert(f.schema.taskDependency).values({
      organizationId: f.orgId,
      blockingTaskId: root.id,
      blockedTaskId: child.id,
    });
    const unrecorded = await loadBlueprintSnapshot(
      tx,
      f.caller,
      { kind: 'task', id: root.id },
      { scope: 'tree' },
    );
    expect(await loadManagedBlueprintDependencies(tx, unrecorded)).toEqual([]);
    // This genuine compound creation owns an ordinary edge, but contains no authored template rule.
    await recordChangeSetInTransaction(tx, {
      orgId: f.orgId,
      actorId: f.humanActorId,
      origin: { ...appProvenance(), v: 2, tool: 'manual_creation' },
      summary: 'Created manual work',
      changes: [
        { kind: 'task', id: root.id, op: 'create', after: trackedFields('task', root) },
        { kind: 'task', id: child.id, op: 'create', after: trackedFields('task', child) },
        { kind: 'blocks', from: root.id, to: child.id, linked: true },
      ],
    });
    return { root, child };
  });
  const owned = await f.schema.db.transaction(async (tx) => {
    const snapshot = await loadBlueprintSnapshot(
      tx,
      f.caller,
      { kind: 'task', id: manual.root.id },
      { scope: 'tree' },
    );
    expect(snapshot.dependencies).toEqual([
      { blockerId: manual.root.id, blockedId: manual.child.id },
    ]);
    return loadManagedBlueprintDependencies(tx, snapshot);
  });
  expect(owned).toEqual([]);
  expect(
    await f.schema.db
      .select()
      .from(f.schema.taskDependency)
      .where(eq(f.schema.taskDependency.blockingTaskId, manual.root.id)),
  ).toHaveLength(1);
});
