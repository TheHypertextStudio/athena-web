/** Stable scope traversal and dependency selection, independent of rendering. */
import type { GraphData, GraphInput, GraphRelation, GraphWork } from './contract';

/** Whether a relation is a saved dependency rather than membership. */
export function isDependency(r: GraphRelation): boolean {
  return r.kind === 'task_dependency' || r.kind === 'project_dependency';
}
/** Canonical terminal status, consistent with web graph annotation. */
export function isEnded(n: GraphWork): boolean {
  return n.category === 'completed' || n.category === 'canceled';
}
function nextScopeKeys(
  relations: readonly GraphRelation[],
  frontier: readonly string[],
  taskMode: boolean,
): string[] {
  const keys: string[] = [];
  for (const r of relations) {
    if (!taskMode && isDependency(r)) continue;
    if (frontier.includes(r.source)) keys.push(r.target);
    if (taskMode && isDependency(r) && frontier.includes(r.target)) keys.push(r.source);
  }
  return keys;
}
/** All authorized descendants of the root, or a bounded task neighborhood. */
export function scopeKeys(data: GraphData, input: GraphInput): Set<string> {
  const root = `${input.scope.kind}:${input.scope.id}`;
  const keys = new Set([root]);
  let frontier = [root];
  let remaining = input.scope.kind === 'task' ? input.depth : data.nodes.length;
  while (frontier.length && remaining-- > 0) {
    const next = new Set<string>();
    for (const key of nextScopeKeys(data.relations, frontier, input.scope.kind === 'task'))
      if (!keys.has(key)) next.add(key);
    frontier = [...next];
    for (const key of frontier) keys.add(key);
  }
  return keys;
}
/** Stable importance ordering; visible blockers influence display without asserting readiness. */
export function orderWork(
  nodes: readonly GraphWork[],
  relations: readonly GraphRelation[],
  focus?: string,
): GraphWork[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const started = new Set(nodes.filter((n) => n.category === 'started').map((n) => n.key));
  const priority = ['urgent', 'high', 'medium', 'low', 'none'];
  const neighbors = new Set(
    relations
      .filter((r) => isDependency(r) && (r.source === focus || r.target === focus))
      .flatMap((r) => [r.source, r.target]),
  );
  const prerequisites = new Set(
    relations
      .filter((r) => {
        const blocker = byKey.get(r.source);
        return (
          isDependency(r) && started.has(r.target) && blocker !== undefined && !isEnded(blocker)
        );
      })
      .map((r) => r.source),
  );
  const blocked = new Set(
    relations
      .filter((r) => {
        const source = byKey.get(r.source);
        return isDependency(r) && source !== undefined && !isEnded(source);
      })
      .map((r) => r.target),
  );
  const rank = (n: GraphWork): number => {
    if (n.key === focus) return 0;
    if (neighbors.has(n.key)) return 1;
    if (started.has(n.key)) return 2;
    if (prerequisites.has(n.key)) return 3;
    if (isEnded(n)) return 6;
    return blocked.has(n.key) ? 5 : 4;
  };
  return [...nodes].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      priority.indexOf(a.priority) - priority.indexOf(b.priority) ||
      a.title.localeCompare(b.title) ||
      a.key.localeCompare(b.key),
  );
}
/** Pick one actual containment parent; task parents take precedence over project placement. */
export function parentKeys(relations: readonly GraphRelation[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const r of relations
    .filter((r) => r.kind === 'contains')
    .sort((a, b) => a.source.localeCompare(b.source))) {
    if (!parents.has(r.target) || r.source.startsWith('task:')) parents.set(r.target, r.source);
  }
  return parents;
}

/** Favor one connected story over unrelated leading rows in a compact graph. */
export function inlineSlice(
  candidates: readonly GraphWork[],
  relations: readonly GraphRelation[],
  scoped: ReadonlySet<string>,
  limit: number,
  focus?: string,
): GraphWork[] {
  const primary =
    candidates.find((n) => n.key === focus) ??
    candidates.find((n) => scoped.has(n.key)) ??
    candidates[0];
  if (!primary) return [];
  const chosen = [primary];
  const selected = new Set([primary.key]);
  while (chosen.length < Math.min(limit, candidates.length)) {
    const adjacent = new Set(
      relations
        .filter((r) => isDependency(r) && (selected.has(r.source) || selected.has(r.target)))
        .flatMap((r) => [r.source, r.target]),
    );
    const next =
      candidates.find((n) => !selected.has(n.key) && adjacent.has(n.key)) ??
      candidates.find((n) => !selected.has(n.key));
    if (!next) break;
    chosen.push(next);
    selected.add(next.key);
  }
  return chosen;
}
