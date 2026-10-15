import { createHash } from 'node:crypto';
import { required, type RetainedGraph, type RetainedRow } from './contracts';

/** Frozen structural mapping before canonical publication; references retain original source IDs. */
export interface NormalizedLegacyStep {
  readonly id: string;
  readonly key: string;
  readonly row: RetainedRow;
  readonly spec: RetainedRow;
  readonly kind: 'project' | 'milestone' | 'task';
  readonly parentId: string | null;
  readonly rootId: string;
  readonly path: readonly string[];
}

function canonicalKey(key: string): string {
  return /^[a-z][a-z0-9_-]{0,63}$/.test(key)
    ? key
    : `legacy_${createHash('sha256').update(key).digest('hex').slice(0, 48)}`;
}

function parentId(kind: NormalizedLegacyStep['kind'], spec: RetainedRow): string | null {
  const value =
    kind === 'milestone'
      ? spec['project_step_id']
      : (spec['parent_task_step_id'] ?? spec['milestone_step_id'] ?? spec['project_step_id']);
  return typeof value === 'string' ? value : null;
}

function sourceStep(
  graph: RetainedGraph,
  row: RetainedRow,
): Omit<NormalizedLegacyStep, 'rootId' | 'path'> {
  const id = required(row, 'id');
  const kind = required(row, 'kind');
  if (kind !== 'project' && kind !== 'milestone' && kind !== 'task')
    throw new Error('Unsupported retained step kind.');
  const specs = { project: graph.projects, milestone: graph.milestones, task: graph.tasks }[kind];
  const matching = specs.filter((spec) => spec['step_id'] === id);
  const spec = matching[0];
  if (matching.length !== 1 || !spec)
    throw new Error('Retained step has missing or duplicate fields.');
  return {
    id,
    key: canonicalKey(required(row, 'key')),
    row,
    spec,
    kind,
    parentId: kind === 'project' ? null : parentId(kind, spec),
  };
}

function resolvePath(
  id: string,
  steps: ReadonlyMap<string, Omit<NormalizedLegacyStep, 'rootId' | 'path'>>,
  visiting: Set<string>,
): { rootId: string; path: string[] } {
  if (visiting.has(id)) throw new Error('Retained hierarchy contains a cycle.');
  const step = steps.get(id);
  if (!step) throw new Error('Retained parent is outside its revision.');
  if (step.parentId === null) {
    if (step.kind === 'milestone') throw new Error('A retained Milestone needs its Project.');
    return { rootId: id, path: [] };
  }
  visiting.add(id);
  const parent = steps.get(step.parentId);
  if (
    !parent ||
    (parent.kind === 'milestone' && step.kind !== 'task') ||
    (parent.kind === 'task' && step.kind !== 'task')
  )
    throw new Error('Invalid retained parent kind.');
  const path = resolvePath(step.parentId, steps, visiting);
  visiting.delete(id);
  return { rootId: path.rootId, path: [...path.path, step.key] };
}

function assertAcyclic(edges: readonly [string, string][], ids: ReadonlySet<string>): void {
  const next = new Map<string, string[]>();
  for (const [before, after] of edges) {
    if (!ids.has(before) || !ids.has(after) || before === after)
      throw new Error('Retained prerequisite is outside its graph.');
    next.set(before, [...(next.get(before) ?? []), after]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Retained prerequisites contain a cycle.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of next.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

/** Validate and normalize a complete retained graph without allocating rows or changing work. */
export function normalizeLegacyBlueprint(graph: RetainedGraph): readonly NormalizedLegacyStep[] {
  if (graph.steps.length > 500 || graph.dependencies.length > 2000)
    throw new Error('Retained blueprint exceeds its bounded graph limit.');
  const entries = graph.steps.map((row) => sourceStep(graph, row));
  const map = new Map(entries.map((step) => [step.id, step]));
  if (
    map.size !== entries.length ||
    new Set(entries.map((step) => step.key)).size !== entries.length
  )
    throw new Error('Retained step identities or normalized keys collide.');
  const edges: [string, string][] = graph.dependencies.map((edge) => [
    required(edge, 'blocking_step_id'),
    required(edge, 'blocked_step_id'),
  ]);
  for (const step of entries)
    if (step.row['timing_kind'] === 'after_step_completion')
      edges.push([required(step.row, 'after_step_id'), step.id]);
  assertAcyclic(edges, new Set(map.keys()));
  return entries.map((step) => ({ ...step, ...resolvePath(step.id, map, new Set()) }));
}
