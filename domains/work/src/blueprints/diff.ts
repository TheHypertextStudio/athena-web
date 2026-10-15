import type {
  BlueprintDateField,
  BlueprintDifference,
  BlueprintDiffInput,
  BlueprintPath,
  ExistingBlueprintNode,
  PlannedWorkNode,
} from './types';
import { BlueprintError, pathKey, requireBlueprintValue } from './errors';
import { planBlueprint } from './rules';
import { expandBlueprint } from './expand';
import {
  matchedBlueprintRow,
  canAddBlueprintNode,
  canCancelBlueprintRow,
  type BlueprintMatchIndex,
} from './diff-matching';

/** Stable display-choice identifier, independent of array ordering; review tokens provide integrity. */
function changeId(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 14695981039346656037n;
  for (const point of text)
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(requireBlueprintValue(point.codePointAt(0)))) * 1099511628211n,
    );
  return `bp_${hash.toString(16).padStart(16, '0')}`;
}
function samePath(left: BlueprintPath | null, right: BlueprintPath | null): boolean {
  return pathKey(left ?? []) === pathKey(right ?? []);
}
function terminal(row: ExistingBlueprintNode): boolean {
  return row.state === 'completed' || row.state === 'canceled';
}
function descendant(
  node: PlannedWorkNode,
  ancestor: BlueprintPath,
  nodes: readonly PlannedWorkNode[],
): boolean {
  let current: PlannedWorkNode | undefined = node;
  while (current) {
    if (samePath(current.path, ancestor)) return true;
    const parentPath: BlueprintPath | null = current.parentPath;
    current =
      parentPath === null ? undefined : nodes.find((entry) => samePath(entry.path, parentPath));
  }
  return false;
}
function hasManualDate(row: ExistingBlueprintNode, field: BlueprintDateField): boolean {
  const binding = row.dateBindings[field];
  return binding?.manual === true || (!binding && row.dates[field] !== undefined);
}
function dateDifferences(row: ExistingBlueprintNode, node: PlannedWorkNode): BlueprintDifference[] {
  if (terminal(row)) return [];
  const differences: BlueprintDifference[] = [];
  for (const field of [
    'startDate',
    'dueDate',
    'targetDate',
  ] as const satisfies readonly BlueprintDateField[]) {
    const binding = node.dateBindings[field];
    const previousBinding = row.dateBindings[field];
    if (!binding || hasManualDate(row, field)) continue;
    const previous = row.dates[field] ?? null;
    const value = node.dates[field] ?? null;
    if (
      previous === value &&
      JSON.stringify(previousBinding?.rule) === JSON.stringify(binding.rule)
    )
      continue;
    differences.push({
      changeId: changeId(['date', node.sourceWorkTypeId, node.path, field, value, binding.rule]),
      kind: 'set_derived_date',
      path: node.path,
      id: row.id,
      field,
      previous,
      value,
      rule: binding.rule,
      binding,
      selectedByDefault: false,
    });
  }
  return differences;
}
function edgeKey(edge: {
  readonly blockerPath: BlueprintPath;
  readonly blockedPath: BlueprintPath;
}): string {
  return JSON.stringify([edge.blockerPath, edge.blockedPath]);
}
function dependencyDifferences(
  input: BlueprintDiffInput,
  edges: ReturnType<typeof planBlueprint>['dependencies'],
): BlueprintDifference[] {
  const differences: BlueprintDifference[] = [];
  const mutable = (path: BlueprintPath): boolean =>
    !input.current.some((row) => samePath(row.path, path) && terminal(row));
  for (const edge of edges)
    if (
      !input.currentDependencies.some((current) => edgeKey(current) === edgeKey(edge)) &&
      mutable(edge.blockerPath) &&
      mutable(edge.blockedPath)
    )
      differences.push({
        ...edge,
        kind: 'add_dependency',
        changeId: changeId(['add_dependency', edge]),
        selectedByDefault: false,
      });
  for (const edge of input.currentDependencies) {
    if (input.mode === 'change') continue;
    if (
      !edge.serviceOwned ||
      edges.some((next) => edgeKey(next) === edgeKey(edge)) ||
      !mutable(edge.blockerPath) ||
      !mutable(edge.blockedPath)
    )
      continue;
    const generated = input.current.some(
      (row) => row.sourceStepId !== null && samePath(row.path, edge.blockerPath),
    );
    if (generated)
      differences.push({
        kind: 'remove_dependency',
        blockerPath: edge.blockerPath,
        blockedPath: edge.blockedPath,
        changeId: changeId(['remove_dependency', edge.blockerPath, edge.blockedPath]),
        selectedByDefault: false,
      });
  }
  return differences;
}
function removedDifferences(
  input: BlueprintDiffInput,
  children: readonly PlannedWorkNode[],
  index: BlueprintMatchIndex,
): BlueprintDifference[] {
  const differences: BlueprintDifference[] = [];
  if (input.mode === 'change') return differences;
  for (const row of [...input.current].sort((a, b) =>
    pathKey(a.path).localeCompare(pathKey(b.path)),
  )) {
    if (
      !canCancelBlueprintRow(row, input.current) ||
      children.some((node) => matchedBlueprintRow(index, node)?.id === row.id)
    )
      continue;
    differences.push({
      kind: 'cancel_removed_child',
      changeId: changeId(['cancel_removed_child', row.sourceWorkTypeId, row.path, row.id]),
      path: row.path,
      id: row.id,
      selectedByDefault: false,
    });
  }
  return differences;
}
function previewPlan(input: BlueprintDiffInput): ReturnType<typeof planBlueprint> {
  const expanded = expandBlueprint(input.selected.graph, input.selected.choices);
  const choices = expanded.nodes
    .filter((node) => node.step?.optional.enabled)
    .map((node) => ({ path: [...node.path], selected: true }));
  const planned = planBlueprint({ ...input.selected, choices });
  const selected = new Set(
    expanded.nodes.filter((node) => node.selected).map((node) => pathKey(node.path)),
  );
  return {
    ...planned,
    nodes: planned.nodes.map((node) => ({ ...node, selected: selected.has(pathKey(node.path)) })),
    dependencies: planned.dependencies.filter(
      (edge) => selected.has(pathKey(edge.blockerPath)) && selected.has(pathKey(edge.blockedPath)),
    ),
  };
}
/**
 * Compare exact generated provenance, preserving authored work and requiring explicit per-field adoption.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function diffBlueprint(input: BlueprintDiffInput): BlueprintDifference[] {
  if (input.selected.root.terminal) {
    if (input.mode === 'update')
      throw new BlueprintError(
        'blueprint_invalid',
        'Terminal work cannot update its template version.',
      );
    return [];
  }
  const planned = previewPlan(input);
  const children = planned.nodes.filter((node) => node.parentPath !== null);
  const index: BlueprintMatchIndex = {
    current: input.current,
    planned: planned.nodes,
    matches: new Map(),
  };
  const additions = children.filter(
    (node) => !matchedBlueprintRow(index, node) && canAddBlueprintNode(index, node),
  );
  if (input.current.length + additions.length > 500)
    throw new BlueprintError(
      'blueprint_limit',
      'Selective preview limit is 500 existing and new work rows.',
    );
  const differences: BlueprintDifference[] = [];
  for (const node of additions) {
    if (
      additions.some(
        (parent) => !samePath(parent.path, node.path) && descendant(node, parent.path, children),
      )
    )
      continue;
    const subtree = additions.filter((child) => descendant(child, node.path, children));
    differences.push({
      kind: 'add_child',
      changeId: changeId(['add_child', node.sourceWorkTypeId, node.path, planned.manifest]),
      path: node.path,
      nodes: subtree,
      count: subtree.length,
      selectedByDefault: node.selected,
    });
  }
  for (const node of children) {
    if (input.mode !== 'update') continue;
    const row = matchedBlueprintRow(index, node);
    if (row) differences.push(...dateDifferences(row, node));
  }
  differences.push(...removedDifferences(input, children, index));
  differences.push(...dependencyDifferences(input, planned.dependencies));
  return differences;
}
