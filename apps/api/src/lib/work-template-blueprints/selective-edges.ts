import { taskDependency } from '@docket/db';
import { BlueprintError } from '@docket/work/blueprints';
import { and, eq } from 'drizzle-orm';
import { edgeKey } from '../../mcp/change-set';
import type { RecordedChange } from '../../mcp/change-set';
import { requireWorkAccess } from '../work-template-selection';
import type { TemplateTransaction } from '../templates/persistence';
import { closesWorkspaceDependencyCycle } from '../work-dependency-forest';
import type { PreparedBlueprintCreation } from './preflight';
import type { PreparedSelectiveReview } from './selective-review';
import {
  loadManagedBlueprintDependencies,
  type ManagedBlueprintDependency,
} from './managed-dependencies';

/** Concrete individually reviewed edge changes, authorized before any child insert. */
export interface PreparedSelectiveEdges {
  readonly additions: readonly ManagedBlueprintDependency[];
  readonly removals: readonly ManagedBlueprintDependency[];
  readonly owned: readonly ManagedBlueprintDependency[];
}
async function resolveSelectedEdges(
  tx: TemplateTransaction,
  review: PreparedSelectiveReview,
  tree: PreparedBlueprintCreation,
  accepted: ReadonlySet<string>,
) {
  const byPath = new Map(
    tree.entries.map((entry) => [JSON.stringify(entry.allocated.node.path), entry]),
  );
  const additions: ManagedBlueprintDependency[] = [],
    removals: ManagedBlueprintDependency[] = [];
  for (const change of review.differences) {
    if (
      !accepted.has(change.changeId) ||
      (change.kind !== 'add_dependency' && change.kind !== 'remove_dependency')
    )
      continue;
    const blocker = byPath.get(JSON.stringify(change.blockerPath)),
      blocked = byPath.get(JSON.stringify(change.blockedPath));
    if (blocker?.allocated.node.kind !== 'task' || blocked?.allocated.node.kind !== 'task')
      throw new BlueprintError(
        'blueprint_prerequisite',
        'Select the work required by this dependency.',
      );
    for (const entry of [blocker, blocked])
      if (entry.kind === 'existing')
        await requireWorkAccess(tx, review.caller, 'task', entry.work.id);
    const edge = { blockerId: blocker.allocated.id, blockedId: blocked.allocated.id };
    (change.kind === 'add_dependency' ? additions : removals).push(edge);
  }
  return { additions, removals };
}

/** Resolve reviewed paths only through exact actual matches or server-allocated accepted children. */
export async function prepareSelectiveEdges(
  tx: TemplateTransaction,
  review: PreparedSelectiveReview,
  tree: PreparedBlueprintCreation,
  accepted: ReadonlySet<string>,
): Promise<PreparedSelectiveEdges> {
  const { additions, removals } = await resolveSelectedEdges(tx, review, tree, accepted);
  if (review.snapshot.dependencies.length - removals.length + additions.length > 2000)
    throw new BlueprintError('blueprint_limit', 'Review at most 2000 dependencies.');
  if (
    await closesWorkspaceDependencyCycle(
      tx,
      review.caller.orgId,
      'task',
      additions.map((edge) => ({ from: edge.blockerId, to: edge.blockedId })),
      removals.map((edge) => ({ from: edge.blockerId, to: edge.blockedId })),
    )
  )
    throw new BlueprintError('blueprint_loop', 'Dependencies cannot form a cycle.');
  const previous = await loadManagedBlueprintDependencies(tx, review.snapshot);
  const removed = new Set(removals.map((edge) => edgeKey(edge.blockerId, edge.blockedId)));
  return {
    additions,
    removals,
    owned: [
      ...previous.filter((edge) => !removed.has(edgeKey(edge.blockerId, edge.blockedId))),
      ...additions,
    ],
  };
}
/** Apply only server-resolved accepted edges in the existing outer transaction and undo receipt. */
export async function writeSelectiveEdges(
  tx: TemplateTransaction,
  orgId: string,
  edges: PreparedSelectiveEdges,
): Promise<RecordedChange[]> {
  for (const edge of edges.removals)
    await tx
      .delete(taskDependency)
      .where(
        and(
          eq(taskDependency.organizationId, orgId),
          eq(taskDependency.blockingTaskId, edge.blockerId),
          eq(taskDependency.blockedTaskId, edge.blockedId),
        ),
      );
  if (edges.additions.length)
    await tx.insert(taskDependency).values(
      edges.additions.map((edge) => ({
        organizationId: orgId,
        blockingTaskId: edge.blockerId,
        blockedTaskId: edge.blockedId,
      })),
    );
  return [
    ...edges.removals.map((edge) => ({
      kind: 'blocks' as const,
      from: edge.blockerId,
      to: edge.blockedId,
      linked: false,
    })),
    ...edges.additions.map((edge) => ({
      kind: 'blocks' as const,
      from: edge.blockerId,
      to: edge.blockedId,
      linked: true,
    })),
  ];
}
