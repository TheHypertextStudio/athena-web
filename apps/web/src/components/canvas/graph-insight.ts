/**
 * `components/canvas/graph-insight` — critical-path + bottleneck analysis over the dependency DAG.
 *
 * @remarks
 * Server-safe pure functions (no React) so they can be unit-tested in isolation. Only `dependency`
 * edges participate (subtask edges are hierarchy, not scheduling). The dependency graph is
 * server-enforced acyclic; the topological pass bails gracefully if a stray cycle ever slips
 * through, returning empty insights rather than looping.
 */
import { pushTo } from './graph-adjacency';

/** A task is a bottleneck once it transitively blocks at least this many others. */
export const BOTTLENECK_THRESHOLD = 3;

/** The minimal node shape insight reads (a structural superset of `TaskGraphNode`). */
export interface InsightNode {
  /** The task id. */
  id: string;
  /** Effort points, or null — weights the critical path (falls back to 1 = hop count). */
  estimate: number | null;
}

/** The minimal edge shape insight reads. */
export interface InsightEdge {
  /** The edge id (`dep:<a>:<b>` for dependencies). */
  id: string;
  /** Edge kind; only `dependency` participates. */
  kind: 'dependency' | 'subtask';
  /** Blocker (source) node id. */
  source: string;
  /** Blocked (target) node id. */
  target: string;
}

/** The derived insights: the critical path plus a per-node downstream (bottleneck) count. */
export interface GraphInsights {
  /** Node ids on the longest (critical) dependency path. */
  criticalNodeIds: Set<string>;
  /** Edge ids on the critical path. */
  criticalEdgeIds: Set<string>;
  /** Node id → number of tasks it transitively blocks (its downstream reach). */
  bottleneck: Map<string, number>;
  /** The nodes whose downstream reach meets {@link BOTTLENECK_THRESHOLD}. */
  bottleneckIds: Set<string>;
}

/** A node's critical-path weight: its estimate when positive, else 1 (hop count fallback). */
function weightOf(estimate: number | null): number {
  return estimate !== null && estimate > 0 ? estimate : 1;
}

/** A stable string key for the ordered pair (source, target). */
function pairKey(source: string, target: string): string {
  return `${source}→${target}`;
}

/**
 * Compute the critical path (longest weighted dependency chain) and per-node downstream counts.
 *
 * @param nodes - The graph nodes (carry `estimate`).
 * @param edges - The graph edges (only `dependency` edges are used).
 * @returns the {@link GraphInsights}.
 */
export function computeInsights(
  nodes: readonly InsightNode[],
  edges: readonly InsightEdge[],
): GraphInsights {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const weight = new Map(nodes.map((n): [string, number] => [n.id, weightOf(n.estimate)]));

  // Dependency adjacency (source blocks target), and edge lookup for path reconstruction.
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>(ids.map((id): [string, number] => [id, 0]));
  const edgeId = new Map<string, string>();
  for (const e of edges) {
    if (e.kind !== 'dependency' || !idSet.has(e.source) || !idSet.has(e.target)) continue;
    pushTo(out, e.source, e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    edgeId.set(pairKey(e.source, e.target), e.id);
  }

  // Kahn topological order (decrement `indeg` in place; it has no reader after the queue seed).
  const order: string[] = [];
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  while (queue.length > 0) {
    const u = queue.shift();
    if (u === undefined) break;
    order.push(u);
    for (const v of out.get(u) ?? []) {
      const d = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }
  // A stray cycle would leave nodes unordered — bail with empty critical path (keep bottleneck safe).
  const acyclic = order.length === ids.length;

  // Longest-path DP over the topo order; track predecessor to reconstruct the path.
  const dist = new Map<string, number>(
    ids.map((id): [string, number] => [id, weight.get(id) ?? 1]),
  );
  const prev = new Map<string, string | null>(ids.map((id): [string, string | null] => [id, null]));
  let endNode: string | null = null;
  let best = -Infinity;
  if (acyclic) {
    for (const u of order) {
      const du = dist.get(u) ?? 0;
      for (const v of out.get(u) ?? []) {
        const candidate = du + (weight.get(v) ?? 1);
        if (candidate > (dist.get(v) ?? 0)) {
          dist.set(v, candidate);
          prev.set(v, u);
        }
      }
    }
    for (const id of ids) {
      const d = dist.get(id) ?? 0;
      if (d > best) {
        best = d;
        endNode = id;
      }
    }
  }

  const criticalNodeIds = new Set<string>();
  const criticalEdgeIds = new Set<string>();
  // Only surface a path when there's an actual chain (>1 node), not a lone task.
  if (endNode !== null && prev.get(endNode) != null) {
    let cur: string | null = endNode;
    while (cur !== null) {
      criticalNodeIds.add(cur);
      const parent: string | null = prev.get(cur) ?? null;
      if (parent !== null) {
        const eid = edgeId.get(pairKey(parent, cur));
        if (eid !== undefined) criticalEdgeIds.add(eid);
      }
      cur = parent;
    }
  }

  // Downstream reach per node, in reverse topological order: descendants[v] = ∪ over out-neighbors.
  const bottleneck = new Map<string, number>(ids.map((id): [string, number] => [id, 0]));
  if (acyclic) {
    const descendants = new Map<string, Set<string>>();
    for (let i = order.length - 1; i >= 0; i--) {
      const u = order[i];
      if (u === undefined) continue;
      const reach = new Set<string>();
      for (const v of out.get(u) ?? []) {
        reach.add(v);
        for (const w of descendants.get(v) ?? []) reach.add(w);
      }
      descendants.set(u, reach);
      bottleneck.set(u, reach.size);
    }
  }
  const bottleneckIds = new Set(
    ids.filter((id) => (bottleneck.get(id) ?? 0) >= BOTTLENECK_THRESHOLD),
  );

  return { criticalNodeIds, criticalEdgeIds, bottleneck, bottleneckIds };
}
