import { BlueprintError, pathKey, requireBlueprintValue } from './errors';
import type { BlueprintWorkKind } from './types';

const children: Readonly<Record<BlueprintWorkKind, readonly BlueprintWorkKind[]>> = {
  initiative: ['program', 'project'],
  program: ['project', 'task'],
  project: ['milestone', 'task'],
  milestone: ['task'],
  task: ['task'],
};
/**
 * Assert the existing physical containment matrix without inventing work kinds.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function assertBlueprintHierarchy(
  parent: BlueprintWorkKind,
  child: BlueprintWorkKind,
): void {
  if (!children[parent].includes(child))
    throw new BlueprintError(
      'blueprint_invalid',
      `Invalid blueprint hierarchy: ${parent} cannot contain ${child}.`,
    );
}
/**
 * Refuse cycles in a qualified prerequisite graph.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function assertAcyclic(edges: ReadonlyMap<string, readonly string[]>): void {
  const visited = new Set<string>();
  const active = new Set<string>();
  for (const root of edges.keys()) {
    const pending = [{ key: root, exit: false }];
    while (pending.length > 0) {
      const entry = requireBlueprintValue(pending.pop());
      if (entry.exit) {
        active.delete(entry.key);
        visited.add(entry.key);
        continue;
      }
      if (active.has(entry.key))
        throw new BlueprintError('blueprint_loop', 'Blueprint prerequisite cycle.');
      if (visited.has(entry.key)) continue;
      active.add(entry.key);
      pending.push({ key: entry.key, exit: true });
      for (const next of edges.get(entry.key) ?? []) pending.push({ key: next, exit: false });
    }
  }
}

/**
 * Bound distinct containment, dependency and timing prerequisites for a selected logical graph.
 * @throws {BlueprintError} When the graph exceeds 2,000 selected prerequisite edges.
 */
export function assertStructuralEdgeLimit(
  nodes: readonly {
    readonly path: readonly string[];
    readonly selected: boolean;
    readonly prerequisitePaths: readonly (readonly string[])[];
  }[],
): void {
  const selected = new Set(nodes.filter((node) => node.selected).map((node) => pathKey(node.path)));
  const count = nodes
    .filter((node) => node.selected)
    .reduce(
      (total, node) =>
        total +
        new Set(
          node.prerequisitePaths
            .filter((path) => selected.has(pathKey(path)))
            .map((path) => pathKey(path)),
        ).size,
      0,
    );
  if (count > 2000)
    throw new BlueprintError('blueprint_limit', 'Combined blueprint graph edge limit is 2000.');
}
