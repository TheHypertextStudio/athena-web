import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { flushDeferredWork } from '../../src/lib/after-response';
import { appProvenance } from '../../src/lib/provenance/context';
import { recordChangeSetInTransaction } from '../../src/mcp/change-set';
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
