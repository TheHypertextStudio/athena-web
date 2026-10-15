import {
  expandBlueprint,
  type BlueprintDifference,
  type ResolvedBlueprintGraph,
} from '@docket/work/blueprints';
import type { OptionalChoice } from '@docket/work/work-template-blueprint';

/** Keep only saved optional choices that still belong to this immutable publication closure. */
export function currentSelectiveChoices(
  graph: ResolvedBlueprintGraph,
  saved: readonly OptionalChoice[],
): OptionalChoice[] {
  const allowed = new Set(
    expandBlueprint(graph, [])
      .nodes.filter((node) => node.step?.optional.enabled)
      .map((node) => JSON.stringify(node.path)),
  );
  return saved.filter((choice) => allowed.has(JSON.stringify(choice.path)));
}
/** Explicitly accepted optional subtree roots use the same authored/default planner as normal creation. */
export function acceptedSelectiveChoices(
  graph: ResolvedBlueprintGraph,
  saved: readonly OptionalChoice[],
  differences: readonly BlueprintDifference[],
  accepted: ReadonlySet<string>,
): OptionalChoice[] {
  const choices = new Map(
    currentSelectiveChoices(graph, saved).map((choice) => [JSON.stringify(choice.path), choice]),
  );
  for (const change of differences) {
    if (change.kind !== 'add_child') continue;
    const root = change.nodes.find(
      (node) => JSON.stringify(node.path) === JSON.stringify(change.path),
    );
    if (root?.step?.optional.enabled)
      choices.set(JSON.stringify(change.path), {
        path: [...change.path],
        selected: accepted.has(change.changeId),
      });
  }
  return [...choices.values()];
}
/** Resolve selected paths without treating an accepted parent as consent to its default-off descendants. */
export function selectedSelectivePaths(
  graph: ResolvedBlueprintGraph,
  choices: readonly OptionalChoice[],
): ReadonlySet<string> {
  return new Set(
    expandBlueprint(graph, choices)
      .nodes.filter((node) => node.selected)
      .map((node) => JSON.stringify(node.path)),
  );
}
