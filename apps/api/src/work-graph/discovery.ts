/** Authorized discovery metadata for work hidden by grouping, completion or paging. */
import type { GraphData, GraphInput, GraphSnapshot, GraphWork } from './contract';
import { isDependency } from './selection';

/** Resolve an authorized containment breadcrumb, excluding the selected root. */
export function graphContext(
  key: string,
  parents: ReadonlyMap<string, string>,
  byKey: ReadonlyMap<string, GraphWork>,
  root: string,
): { trail: { key: string; title: string }[]; trailTruncated: boolean } {
  if (key === root) return { trail: [], trailTruncated: false };
  const trail = [],
    seen = new Set([key]);
  let parent = parents.get(key);
  while (parent && parent !== root && !seen.has(parent) && trail.length < 10) {
    seen.add(parent);
    const work = byKey.get(parent);
    if (!work) break;
    trail.unshift({ key: work.key, title: work.title });
    parent = parents.get(parent);
  }
  return { trail, trailTruncated: Boolean(parent && parent !== root) };
}

/** Search the entire authorized scope independently of the current scene's filters and page. */
export function searchScope(
  data: GraphData,
  scoped: ReadonlySet<string>,
  parents: ReadonlyMap<string, string>,
  input: GraphInput,
): GraphSnapshot['search'] {
  const query = input.search.trim();
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const root = `${input.scope.kind}:${input.scope.id}`;
  const matches = terms.length
    ? data.nodes.filter(
        (n) =>
          scoped.has(n.key) &&
          terms.every((term) => `${n.title} ${n.id}`.toLocaleLowerCase().includes(term)),
      )
    : [];
  matches.sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  const byKey = new Map(data.nodes.map((n) => [n.key, n]));
  return {
    query,
    total: matches.length,
    offset: input.searchOffset,
    hasMore: input.searchOffset + 20 < matches.length,
    results: matches.slice(input.searchOffset, input.searchOffset + 20).map((n) => ({
      ...n,
      ...graphContext(n.key, parents, byKey, root),
    })),
  };
}

/** Name at most twenty authorized connections per node; counts include all known connections. */
export function graphBoundaries(
  data: GraphData,
  shown: ReadonlySet<string>,
): GraphSnapshot['boundaries'] {
  const byKey = new Map(data.nodes.map((n) => [n.key, n]));
  const dependencies = data.relations.filter(isDependency);
  return [...shown]
    .map((key) => {
      const connections = dependencies
        .flatMap((r): { direction: 'incoming' | 'outgoing'; key: string }[] => {
          if (r.target === key && !shown.has(r.source))
            return [{ direction: 'incoming' as const, key: r.source }];
          if (r.source === key && !shown.has(r.target))
            return [{ direction: 'outgoing' as const, key: r.target }];
          return [];
        })
        .flatMap((link) => {
          const work = byKey.get(link.key);
          return work ? [{ direction: link.direction, work }] : [];
        });
      return {
        key,
        incoming: connections.filter((c) => c.direction === 'incoming').length,
        outgoing: connections.filter((c) => c.direction === 'outgoing').length,
        connections: connections.slice(0, 20),
      };
    })
    .filter((b) => b.incoming || b.outgoing);
}

/** Summarize only actual completed prerequisite branches attached to displayed work. */
export function completedBranches(
  data: GraphData,
  shown: ReadonlySet<string>,
): GraphSnapshot['completedBranches'] {
  const done = new Set(data.nodes.filter((n) => n.category === 'completed').map((n) => n.key));
  const dependencies = data.relations.filter(isDependency);
  const result: GraphSnapshot['completedBranches'] = [];
  for (const target of shown) {
    const pending = dependencies
      .filter((r) => r.target === target && done.has(r.source) && !shown.has(r.source))
      .map((r) => r.source);
    const focus = pending[0],
      seen = new Set<string>();
    while (pending.length) {
      const key = pending.pop();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      pending.push(
        ...dependencies.filter((r) => r.target === key && done.has(r.source)).map((r) => r.source),
      );
    }
    if (focus) result.push({ target, focus, count: seen.size });
  }
  return result;
}
