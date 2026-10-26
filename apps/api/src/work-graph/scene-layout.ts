/** Shared ranked layout plus nested container measurement for MCP scenes. */
import { layoutMeasuredGraph } from '@docket/work/graph-layout';
import type { GraphSnapshot } from './contract';

type Node = GraphSnapshot['nodes'][number];
type Edge = GraphSnapshot['edges'][number];
function topLevelKey(key: string, byKey: Map<string, Node>, members: Set<string>): string {
  const seen = new Set<string>();
  let current = byKey.get(key);
  while (current?.parentKey && !members.has(current.key) && !seen.has(current.key)) {
    seen.add(current.key);
    current = byKey.get(current.parentKey);
  }
  return current?.key ?? key;
}
/** Lay out compound groups bottom-up, retaining actual dependency endpoints. */
export function positionScene(
  nodes: Node[],
  edges: Edge[],
  portrait: boolean,
): { width: number; height: number } {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const children = new Map<string, Node[]>();
  for (const n of nodes) {
    const parent = n.parentKey && byKey.has(n.parentKey) ? n.parentKey : '';
    if (!parent) n.parentKey = null;
    const list = children.get(parent) ?? [];
    list.push(n);
    children.set(parent, list);
  }
  const options = {
    direction: portrait ? ('TB' as const) : ('LR' as const),
    aspectRatio: portrait ? 0.75 : 1.6,
  };
  const measure = (parent: string): { width: number; height: number } => {
    const members = children.get(parent) ?? [];
    for (const n of members) {
      const nested = measure(n.key);
      n.width = Math.max(238, nested.width ? nested.width + 40 : 0);
      n.height = nested.height ? nested.height + 82 : 104;
    }
    const memberKeys = new Set(members.map((n) => n.key));
    const top = (key: string) => topLevelKey(key, byKey, memberKeys);
    const links = edges
      .map((e) => ({ source: top(e.source), target: top(e.target) }))
      .filter((e) => e.source !== e.target && memberKeys.has(e.source) && memberKeys.has(e.target));
    if (!members.length) return { width: 0, height: 0 };
    const layout = layoutMeasuredGraph(
      members.map((n) => ({ id: n.key, width: n.width, height: n.height })),
      links,
      options,
    );
    for (const n of members) {
      const point = layout.positions.get(n.key);
      n.x = (point?.x ?? 0) + 20;
      n.y = (point?.y ?? 0) + (parent ? 62 : 20);
    }
    return { width: layout.bounds.width + 40, height: layout.bounds.height + 40 };
  };
  const size = measure('');
  // Parent-before-child recursion resolves coordinates once, without adding a parent's offset twice.
  const placed = new Set<string>();
  const place = (n: Node): void => {
    if (placed.has(n.key)) return;
    const p = n.parentKey ? byKey.get(n.parentKey) : null;
    if (p) {
      place(p);
      n.x += p.x;
      n.y += p.y;
    }
    placed.add(n.key);
  };
  for (const n of nodes) place(n);
  return { width: Math.max(size.width, 280), height: Math.max(size.height, 140) };
}
