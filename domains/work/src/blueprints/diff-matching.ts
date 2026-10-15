import { pathKey } from './errors';
import type { ExistingBlueprintNode, PlannedWorkNode } from './types';

/** Memoized matching against concrete generated ancestry, independent of titles and old step IDs. */
export interface BlueprintMatchIndex {
  readonly current: readonly ExistingBlueprintNode[];
  readonly planned: readonly PlannedWorkNode[];
  readonly matches: Map<string, ExistingBlueprintNode | undefined>;
}
/** Match a logical planned node only when its complete generating lineage still matches. */
export function matchedBlueprintRow(
  index: BlueprintMatchIndex,
  node: PlannedWorkNode,
): ExistingBlueprintNode | undefined {
  const key = pathKey(node.path);
  if (index.matches.has(key)) return index.matches.get(key);
  let matched: ExistingBlueprintNode | undefined;
  if (node.parentPath === null)
    matched = index.current.find(
      (row) =>
        row.parentPath === null && row.kind === node.kind && row.workTypeId === node.workTypeId,
    );
  else {
    const parent = index.planned.find(
      (entry) => pathKey(entry.path) === pathKey(node.parentPath ?? []),
    );
    const matchedParent = parent ? matchedBlueprintRow(index, parent) : undefined;
    if (matchedParent) matched = matchChild(index, node, matchedParent);
  }
  index.matches.set(key, matched);
  return matched;
}
function matchChild(
  index: BlueprintMatchIndex,
  node: PlannedWorkNode,
  parent: ExistingBlueprintNode,
): ExistingBlueprintNode | undefined {
  const candidates = index.current.filter(
    (row) =>
      row.sourceStepId !== null &&
      row.sourceWorkTypeId === node.sourceWorkTypeId &&
      pathKey(row.path) === pathKey(node.path) &&
      row.kind === node.kind,
  );
  const physical = candidates.filter((row) =>
    row.parentId !== undefined
      ? row.parentId === parent.id
      : pathKey(row.parentPath ?? []) === pathKey(parent.path),
  );
  if (physical.length !== 1) return undefined;
  const candidate = physical[0];
  if (
    candidate?.parentId === undefined &&
    index.current.filter((row) => pathKey(row.path) === pathKey(parent.path)).length !== 1
  )
    return undefined;
  return candidate;
}
/** New work cannot be inserted below retained terminal descendants. */
export function canAddBlueprintNode(index: BlueprintMatchIndex, node: PlannedWorkNode): boolean {
  let parentPath = node.parentPath;
  while (parentPath !== null) {
    const parent = index.planned.find((entry) => pathKey(entry.path) === pathKey(parentPath ?? []));
    if (!parent) return false;
    const current = matchedBlueprintRow(index, parent);
    if (current?.state === 'completed' || current?.state === 'canceled') return false;
    parentPath = parent.parentPath;
  }
  return true;
}
function directChildren(
  row: ExistingBlueprintNode,
  nodes: readonly ExistingBlueprintNode[],
): readonly ExistingBlueprintNode[] {
  return nodes.filter((child) =>
    child.parentId !== undefined
      ? child.parentId === row.id
      : child.parentPath !== null && pathKey(child.parentPath) === pathKey(row.path),
  );
}
function safe(row: ExistingBlueprintNode): boolean {
  return row.state === 'unstarted' && !row.everStarted && row.cancellable;
}
/** Cancellation must not cascade into authored, started, terminal or externally owned descendants. */
export function canCancelBlueprintRow(
  row: ExistingBlueprintNode,
  nodes: readonly ExistingBlueprintNode[],
): boolean {
  if (
    row.parentPath === null ||
    row.sourceStepId === null ||
    row.kind === 'milestone' ||
    !safe(row)
  )
    return false;
  const pending = [...directChildren(row, nodes)];
  const seen = new Set([row.id]);
  while (pending.length > 0) {
    const child = pending.pop();
    if (!child || seen.has(child.id) || !safe(child)) return false;
    seen.add(child.id);
    pending.push(...directChildren(child, nodes));
  }
  return true;
}
