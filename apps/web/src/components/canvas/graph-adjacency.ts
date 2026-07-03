/**
 * `components/canvas/graph-adjacency` — shared, React-free graph adjacency helpers.
 *
 * @remarks
 * Both the highlight hook (chain walk) and the insight module (topo/longest-path) need a
 * Map-of-arrays adjacency; keeping the tiny builders here means one definition instead of a copy
 * per consumer. Pure and dependency-free so the server-safe insight code can import it too.
 */

/** Append `value` to a Map-of-arrays bucket, creating the bucket on first use. */
export function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** A directed edge, minimally. */
export interface DirectedEdge {
  source: string;
  target: string;
}

/** Forward (`out`) and reverse (`in`) adjacency maps for a directed edge set. */
export interface Adjacency {
  /** source → targets. */
  out: Map<string, string[]>;
  /** target → sources. */
  in: Map<string, string[]>;
}

/** Build both directions of adjacency in a single pass. */
export function buildAdjacency(edges: readonly DirectedEdge[]): Adjacency {
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const e of edges) {
    pushTo(out, e.source, e.target);
    pushTo(inn, e.target, e.source);
  }
  return { out, in: inn };
}
