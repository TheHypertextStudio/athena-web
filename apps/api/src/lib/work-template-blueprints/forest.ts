import { BlueprintError } from '@docket/work/blueprints';
import type { PlannedWorkNode, PlannedWorkTree } from '@docket/work/blueprints';
import type { WorkCreationBatchCommand } from '../work-creation/types';

/** Minimal authorized planning projection needed for a forest-wide budget and dependency pass. */
export interface PreflightedForestRoot {
  readonly rowCount: number;
  readonly entries: readonly {
    readonly allocated: {
      readonly id: string;
      readonly node: Pick<PlannedWorkNode, 'kind' | 'path'>;
    };
  }[];
  readonly tree: Pick<PlannedWorkTree, 'dependencies'>;
}
/** Fully resolved cross-root dependency, ready for the existing Task dependency writer. */
export interface ResolvedForestDependency {
  readonly blockerId: string;
  readonly blockedId: string;
}

function taskEndpoint(
  roots: ReadonlyMap<string, PreflightedForestRoot>,
  endpoint: WorkCreationBatchCommand['edges'][number]['blocker'],
): string {
  const row = roots
    .get(endpoint.rootKey)
    ?.entries.find(
      (entry) => JSON.stringify(entry.allocated.node.path) === JSON.stringify(endpoint.path),
    );
  if (row?.allocated.node.kind !== 'task')
    throw new BlueprintError(
      'blueprint_invalid',
      'A dependency requires a selected Task at its qualified path.',
    );
  return row.allocated.id;
}

function assertForestDag(edges: readonly ResolvedForestDependency[]): void {
  const outgoing = new Map<string, string[]>(),
    degrees = new Map<string, number>(),
    seen = new Set<string>();
  for (const edge of edges) {
    const key = JSON.stringify([edge.blockerId, edge.blockedId]);
    if (seen.has(key))
      throw new BlueprintError('blueprint_invalid', 'Choose each dependency once.');
    seen.add(key);
    outgoing.set(edge.blockerId, [...(outgoing.get(edge.blockerId) ?? []), edge.blockedId]);
    degrees.set(edge.blockerId, degrees.get(edge.blockerId) ?? 0);
    degrees.set(edge.blockedId, (degrees.get(edge.blockedId) ?? 0) + 1);
  }
  const ready = [...degrees].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  // Array iteration visits newly appended ready nodes, keeping this traversal linear.
  for (const id of ready) {
    visited++;
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (degrees.get(next) ?? 0) - 1;
      degrees.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }
  if (visited !== degrees.size)
    throw new BlueprintError(
      'blueprint_loop',
      'Dependencies cannot form a cycle across generated work.',
    );
}

/** Validate the entire expanded forest before its first write, including cross-root Task edges. */
export function validatePreparedBlueprintForest(
  command: WorkCreationBatchCommand,
  plans: readonly PreflightedForestRoot[],
): ResolvedForestDependency[] {
  if (
    plans.length !== command.roots.length ||
    plans.reduce((count, plan) => count + plan.rowCount, 0) > 500
  )
    throw new BlueprintError(
      'blueprint_limit',
      'Create at most 500 work rows across the complete forest.',
    );
  const roots = new Map(
    command.roots.flatMap((root, index) =>
      plans[index] ? [[root.key, plans[index]] as const] : [],
    ),
  );
  const cross = command.edges.map((edge) => ({
    blockerId: taskEndpoint(roots, edge.blocker),
    blockedId: taskEndpoint(roots, edge.blocked),
  }));
  const internal = command.roots.flatMap((root) => {
    const plan = roots.get(root.key);
    return (
      plan?.tree.dependencies.map((edge) => ({
        blockerId: taskEndpoint(roots, { rootKey: root.key, path: edge.blockerPath }),
        blockedId: taskEndpoint(roots, { rootKey: root.key, path: edge.blockedPath }),
      })) ?? []
    );
  });
  const combined = [...internal, ...cross];
  if (combined.length > 2000)
    throw new BlueprintError(
      'blueprint_limit',
      'Create at most 2000 dependencies across the complete forest.',
    );
  assertForestDag(combined);
  return cross;
}
