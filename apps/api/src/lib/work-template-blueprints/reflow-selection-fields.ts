import type { BlueprintDateField, ExistingBlueprintNode } from '@docket/work/blueprints';

/** Actual changed fields and lifecycle facts, kept separate so planned dates cannot simulate completion. */
export interface BlueprintFieldChanges {
  readonly dates: ReadonlyMap<string, ReadonlySet<BlueprintDateField>>;
  readonly completions: ReadonlySet<string>;
}
interface FieldSelectionInput extends BlueprintFieldChanges {
  readonly nodes: readonly ExistingBlueprintNode[];
}
function sourceAt(
  nodes: readonly ExistingBlueprintNode[],
  node: ExistingBlueprintNode,
  key: string,
): ExistingBlueprintNode | undefined {
  return nodes.find(
    (source) => JSON.stringify(source.path) === JSON.stringify([...node.path.slice(0, -1), key]),
  );
}
function completionChanged(
  node: ExistingBlueprintNode,
  field: BlueprintDateField,
  input: FieldSelectionInput,
): boolean {
  const binding = node.dateBindings[field];
  if (binding?.rule.kind !== 'after_completion') return false;
  const refs = node.dateReferences?.[field];
  return binding.rule.stepKeys.some((key) => {
    const id = refs?.completionIds[key] ?? sourceAt(input.nodes, node, key)?.id;
    return id !== undefined && input.completions.has(id);
  });
}
function milestoneChanged(
  node: ExistingBlueprintNode,
  field: BlueprintDateField,
  input: FieldSelectionInput,
): boolean {
  const rule = node.dateBindings[field]?.rule;
  if (rule?.kind !== 'anchor' || rule.anchor.kind !== 'milestone') return false;
  const id =
    node.dateReferences?.[field]?.milestoneIds[rule.anchor.stepKey] ??
    sourceAt(input.nodes, node, rule.anchor.stepKey)?.id;
  return id !== undefined && Boolean(input.dates.get(id)?.has('targetDate'));
}
function parentChanged(
  node: ExistingBlueprintNode,
  field: BlueprintDateField,
  input: FieldSelectionInput,
): boolean {
  const refs = node.dateReferences?.[field];
  const parent = input.nodes.find((entry) => entry.id === (refs?.parentId ?? node.parentId));
  return (
    parent !== undefined &&
    Boolean(input.dates.get(parent.id)?.has(parent.kind === 'task' ? 'dueDate' : 'targetDate'))
  );
}
function changed(
  node: ExistingBlueprintNode,
  field: BlueprintDateField,
  input: FieldSelectionInput,
): boolean {
  const binding = node.dateBindings[field];
  if (!binding || binding.manual || binding.rule.kind === 'none') return false;
  if (binding.rule.kind === 'after_completion') return completionChanged(node, field, input);
  return binding.rule.anchor.kind === 'milestone'
    ? milestoneChanged(node, field, input)
    : parentChanged(node, field, input);
}
/** Discover only genuinely dependent public fields; containment alone does not authorize a write. */
export function affectedBlueprintDateFields(
  nodes: readonly ExistingBlueprintNode[],
  seeds: ReadonlySet<string>,
  changes: BlueprintFieldChanges,
): ReadonlyMap<string, ReadonlySet<BlueprintDateField>> {
  const present = new Set(nodes.map((node) => node.id));
  const dates = new Map(
    [...changes.dates]
      .filter(([id]) => present.has(id))
      .map(([id, fields]) => [id, new Set(fields)]),
  );
  let again = true;
  while (again) {
    again = false;
    for (const node of nodes) {
      if (seeds.has(node.id) || node.state === 'completed' || node.state === 'canceled') continue;
      for (const field of Object.keys(node.dateBindings) as BlueprintDateField[]) {
        if (
          dates.get(node.id)?.has(field) ||
          !changed(node, field, { nodes, dates, completions: changes.completions })
        )
          continue;
        const fields = dates.get(node.id) ?? new Set<BlueprintDateField>();
        fields.add(field);
        dates.set(node.id, fields);
        again = true;
      }
    }
  }
  return dates;
}
