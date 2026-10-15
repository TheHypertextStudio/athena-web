import { OptionalChoice } from '../contracts/work-template-blueprint';
import type { OptionalChoice as Choice } from '../contracts/work-template-blueprint';
import { assertBlueprintEdgeLimit, buildBlueprintGraph } from './graph';
import { BlueprintError, pathKey } from './errors';
import type { ExpandedBlueprint, ExpandedBlueprintNode, ResolvedBlueprintGraph } from './types';

function readChoices(
  nodes: readonly ExpandedBlueprintNode[],
  choices: readonly Choice[],
): ReadonlyMap<string, boolean> {
  if (choices.length > 499)
    throw new BlueprintError('blueprint_limit', 'Choose at most 499 optional children.');
  const selected = new Map<string, boolean>();
  for (const raw of choices) {
    const choice = OptionalChoice.parse(raw);
    const key = pathKey(choice.path);
    const node = nodes.find((entry) => pathKey(entry.path) === key);
    if (selected.has(key) || !node)
      throw new BlueprintError('blueprint_invalid', 'Unknown or duplicate optional choice.', [
        choice.path,
      ]);
    if (!node.step?.optional.enabled)
      throw new BlueprintError('blueprint_invalid', 'Choices must name optional steps.', [
        choice.path,
      ]);
    selected.set(key, choice.selected);
  }
  return selected;
}
function selectedNodes(
  input: readonly ExpandedBlueprintNode[],
  choices: ReadonlyMap<string, boolean>,
): ExpandedBlueprintNode[] {
  const nodes: ExpandedBlueprintNode[] = [];
  for (const node of input) {
    const parentKey = node.parentPath === null ? null : pathKey(node.parentPath);
    const parentSelected =
      parentKey === null ||
      nodes.find((parent) => pathKey(parent.path) === parentKey)?.selected === true;
    if (!parentSelected && choices.get(pathKey(node.path)) === true)
      throw new BlueprintError(
        'blueprint_prerequisite',
        'Select the optional parent prerequisite explicitly.',
        [node.path, node.parentPath ?? []],
      );
    const ownSelected =
      choices.get(pathKey(node.path)) ?? node.step?.optional.selectedByDefault ?? true;
    nodes.push({ ...node, selected: parentSelected && ownSelected });
  }
  return nodes;
}
function assertSelection(nodes: readonly ExpandedBlueprintNode[]): void {
  const selected = new Set(nodes.filter((node) => node.selected).map((node) => pathKey(node.path)));
  if (selected.size > 500)
    throw new BlueprintError(
      'blueprint_limit',
      'Blueprint limit is 500 work rows including the root and Milestones.',
    );
  for (const node of nodes.filter((entry) => entry.selected))
    for (const path of node.prerequisitePaths) {
      if (!selected.has(pathKey(path)))
        throw new BlueprintError(
          'blueprint_prerequisite',
          'Select the optional prerequisite explicitly.',
          [node.path, path],
        );
    }
}
/**
 * Expand exact publications and apply explicit, prerequisite-closed optional selections.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function expandBlueprint(
  input: ResolvedBlueprintGraph,
  choices: readonly Choice[],
): ExpandedBlueprint {
  const expanded = buildBlueprintGraph(input);
  const nodes = selectedNodes(expanded.nodes, readChoices(expanded.nodes, choices));
  assertSelection(nodes);
  assertBlueprintEdgeLimit(nodes);
  return { ...expanded, nodes };
}
