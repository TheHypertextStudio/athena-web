import { BlueprintError, type ExistingBlueprintNode } from '@docket/work/blueprints';
import { affectedBlueprintNodes } from './reflow-selection';
import type { BlueprintSnapshotOptions, BlueprintSnapshotRow } from './snapshot-types';

function requiredReferences(node: ExistingBlueprintNode): readonly (string | null | undefined)[] {
  return [
    node.parentId,
    ...Object.entries(node.dateReferences ?? {}).flatMap(([field, refs]) =>
      node.dateBindings[field as keyof typeof node.dateBindings]?.manual
        ? []
        : [...Object.values(refs.milestoneIds), ...Object.values(refs.completionIds)],
    ),
  ];
}
function expandRequiredReferences(
  nodes: readonly ExistingBlueprintNode[],
  required: Set<string>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!required.has(node.id)) continue;
      for (const id of requiredReferences(node))
        if (id && !required.has(id)) {
          required.add(id);
          changed = true;
        }
    }
  }
}
/** Keep only changed rows and actual ancestors/prerequisites; unrelated hidden prose never leaves discovery. */
export function selectBlueprintSnapshotRows(
  rows: readonly BlueprintSnapshotRow[],
  nodes: readonly ExistingBlueprintNode[],
  options: BlueprintSnapshotOptions,
): { readonly rows: BlueprintSnapshotRow[]; readonly writes: ReadonlySet<string> } {
  if (options.scope !== 'affected')
    return { rows: [...rows], writes: new Set(nodes.map((node) => node.id)) };
  const seeds = new Set(options.seeds?.map((ref) => ref.id) ?? []);
  if (!seeds.size)
    throw new BlueprintError(
      'blueprint_invalid',
      'Affected snapshots require an exact initiating work reference.',
    );
  const writes = affectedBlueprintNodes(
    nodes,
    seeds,
    new Set(options.dateAnchors ?? []),
    options.fieldChanges,
  );
  if (writes.size > 500)
    throw new BlueprintError('blueprint_limit', 'Reflow at most 500 affected descendants.');
  const required = new Set([...seeds, ...writes]);
  if (nodes[0]) required.add(nodes[0].id);
  expandRequiredReferences(nodes, required);
  return {
    rows: rows.filter(({ work }) => required.has(work.id)),
    writes: new Set([...seeds, ...writes]),
  };
}
