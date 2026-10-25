import {
  BlueprintError,
  type BlueprintDateField,
  type ExistingBlueprintNode,
} from '@docket/work/blueprints';
import type { NativeScheduleDateOwnership } from '@docket/db';

function key(id: string, field: string): string {
  return JSON.stringify([id, field]);
}
function publicSource(
  node: ExistingBlueprintNode,
  field: BlueprintDateField,
  nodes: readonly ExistingBlueprintNode[],
): ExistingBlueprintNode | undefined {
  const binding = node.dateBindings[field];
  if (binding?.rule.kind !== 'anchor') return undefined;
  const refs = node.dateReferences?.[field];
  if (binding.rule.anchor.kind === 'parent')
    return nodes.find((entry) => entry.id === (refs?.parentId ?? node.parentId));
  const stepKey = binding.rule.anchor.stepKey;
  const id = refs?.milestoneIds[stepKey];
  return id
    ? nodes.find((entry) => entry.id === id)
    : nodes.find(
        (entry) =>
          entry.kind === 'milestone' &&
          JSON.stringify(entry.path) === JSON.stringify([...node.path.slice(0, -1), stepKey]),
      );
}
function assertAcyclic(graph: ReadonlyMap<string, ReadonlySet<string>>): void {
  const pending = new Map([...graph].map(([id, next]) => [id, new Set(next)]));
  const ready = [...pending].filter(([, incoming]) => !incoming.size).map(([id]) => id);
  for (const id of ready)
    for (const [target, incoming] of pending) {
      if (!incoming.delete(id) || incoming.size) continue;
      ready.push(target);
    }
  if (new Set(ready).size !== pending.size)
    throw new BlueprintError('blueprint_loop', 'Private and public date fields form a cycle.');
}
function publicEdges(
  nodes: readonly ExistingBlueprintNode[],
  managed: ReadonlySet<string>,
  edge: (target: string, source: string) => void,
): void {
  for (const node of nodes)
    for (const [field, binding] of Object.entries(node.dateBindings)) {
      if (!binding || binding.manual || managed.has(key(node.id, field))) continue;
      const source = publicSource(node, field as BlueprintDateField, nodes);
      if (source && source.kind !== 'program' && source.kind !== 'initiative')
        edge(
          key(node.id, field),
          key(source.id, source.kind === 'task' ? 'dueDate' : 'targetDate'),
        );
    }
}
/** Validate date-field derivation separately from physical containment and actual completion facts. */
export function assertNativeScheduleFieldGraph(
  nodes: readonly ExistingBlueprintNode[],
  ownership: readonly NativeScheduleDateOwnership[],
): void {
  const graph = new Map<string, Set<string>>();
  const managed = new Set(ownership.map((entry) => key(entry.id, entry.field)));
  function edge(target: string, source: string): void {
    if (!graph.has(target)) graph.set(target, new Set());
    if (!graph.has(source)) graph.set(source, new Set());
    graph.get(target)?.add(source);
  }
  for (const entry of ownership)
    if (entry.anchor.kind === 'field' && entry.anchor.source.kind === 'work_date')
      edge(key(entry.id, entry.field), key(entry.anchor.source.work.id, entry.anchor.source.field));
  publicEdges(nodes, managed, edge);
  assertAcyclic(graph);
}
