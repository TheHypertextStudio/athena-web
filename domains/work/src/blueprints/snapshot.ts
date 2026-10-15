import { BlueprintError, pathKey } from './errors';
import type { BlueprintPath, ExistingBlueprintNode } from './types';

/**
 * Resolve an older path-only snapshot conservatively; physical IDs avoid origin-family collisions.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function existingNodeAtPath(
  nodes: readonly ExistingBlueprintNode[],
  path: BlueprintPath,
): ExistingBlueprintNode | undefined {
  const matches = nodes.filter((node) => pathKey(node.path) === pathKey(path));
  if (matches.length > 1)
    throw new BlueprintError(
      'blueprint_invalid',
      'Ambiguous retained origin paths require concrete row references.',
      [path],
    );
  return matches[0];
}
/**
 * Resolve an actual authorized parent, preferring the concrete hierarchy reference.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function existingParent(
  node: ExistingBlueprintNode,
  nodes: readonly ExistingBlueprintNode[],
): ExistingBlueprintNode | undefined {
  if (node.parentId !== undefined) return nodes.find((parent) => parent.id === node.parentId);
  return node.parentPath === null ? undefined : existingNodeAtPath(nodes, node.parentPath);
}
