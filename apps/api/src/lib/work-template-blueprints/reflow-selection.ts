import type { ExistingBlueprintNode } from '@docket/work/blueprints';

function referencesChanged(node: ExistingBlueprintNode, changed: ReadonlySet<string>): boolean {
  return Object.values(node.dateReferences ?? {}).some((refs) =>
    [...Object.values(refs.milestoneIds), ...Object.values(refs.completionIds)].some((id) =>
      changed.has(id),
    ),
  );
}
/** Select actual descendants and concrete accepted dependents while keeping prerequisites read-only. */
export function affectedBlueprintNodes(
  nodes: readonly ExistingBlueprintNode[],
  seeds: ReadonlySet<string>,
  anchors: ReadonlySet<string>,
): ReadonlySet<string> {
  const affected = new Set<string>();
  const changed = new Set(seeds);
  let again = true;
  while (again) {
    again = false;
    for (const node of nodes) {
      if (affected.has(node.id) || seeds.has(node.id)) continue;
      const parentChanged =
        node.parentId && (anchors.has(node.parentId) || affected.has(node.parentId));
      if (!parentChanged && !referencesChanged(node, changed)) continue;
      affected.add(node.id);
      changed.add(node.id);
      again = true;
    }
  }
  return affected;
}
