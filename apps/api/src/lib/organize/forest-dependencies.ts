import { BlueprintError } from '@docket/work/blueprints';
import { CycleError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { closesWorkspaceDependencyCycle } from '../work-dependency-forest';
import type { PreparedPlacementForest } from './forest-types';

/** An authorized physical dependency to be added by the enclosing accepted plan. */
export interface ForestDependency {
  readonly kind: 'task' | 'project';
  readonly from: string;
  readonly to: string;
}

function treeDependencies(forest: PreparedPlacementForest): ForestDependency[] {
  return forest.trees.flatMap((tree) => {
    const nodes = new Map(
      tree.entries.map((entry) => [JSON.stringify(entry.allocated.node.path), entry.allocated.id]),
    );
    return tree.tree.dependencies.map((edge) => {
      const from = nodes.get(JSON.stringify(edge.blockerPath));
      const to = nodes.get(JSON.stringify(edge.blockedPath));
      if (!from || !to)
        throw new BlueprintError('blueprint_invalid', 'A dependency requires both selected Tasks.');
      return { kind: 'task' as const, from, to };
    });
  });
}

/** Validate the complete proposed dependency graph, including paths through current workspace work. */
export async function validatePlacementForestDependencies(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  additional: readonly ForestDependency[],
): Promise<void> {
  const edges = [
    ...new Map(
      [...treeDependencies(forest), ...additional].map((edge) => [JSON.stringify(edge), edge]),
    ).values(),
  ];
  if (edges.length > 2000)
    throw new BlueprintError(
      'blueprint_limit',
      'Create at most 2000 dependencies across the complete forest.',
    );
  if (additional.length === 0) return;
  for (const kind of ['task', 'project'] as const) {
    const selected = edges.filter((edge) => edge.kind === kind);
    if (
      selected.length &&
      (await closesWorkspaceDependencyCycle(tx, forest.caller.orgId, kind, selected))
    )
      throw new CycleError();
  }
}
