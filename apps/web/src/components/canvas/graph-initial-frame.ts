/** Readable first-frame selection for flat nodes and compound hierarchy branches. */
import type { Edge, Node } from '@xyflow/react';

import { projectGraphEdges } from './graph-layout-engine';

/** Nodes and anchor used by the canvas's automatic first frame. */
export interface GraphInitialFrame {
  /** Top-level nodes in the largest weak component. */
  readonly nodeIds: readonly string[];
  /** Stable highest-degree root placed in the upper-left when the component cannot fit. */
  readonly anchorNodeId: string | null;
}

/** Derive the readable first frame from flat nodes or compound hierarchy nodes. */
export function deriveGraphInitialFrame(
  nodes: readonly Node[],
  edges: readonly Edge[],
): GraphInitialFrame {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const topLevelByNode = new Map<string, string>();
  for (const node of nodes) {
    if (node.type === 'group') continue;
    let current = node;
    const seen = new Set<string>();
    while (current.parentId !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.parentId);
      if (parent === undefined || parent.type === 'group') break;
      current = parent;
    }
    topLevelByNode.set(node.id, current.id);
  }
  const roots: string[] = [];
  const rootSet = new Set<string>();
  for (const node of nodes) {
    const root = topLevelByNode.get(node.id);
    if (root === undefined || rootSet.has(root)) continue;
    rootSet.add(root);
    roots.push(root);
  }
  const projected = projectGraphEdges(edges, topLevelByNode).filter(
    (edge) => rootSet.has(edge.source) && rootSet.has(edge.target),
  );
  const adjacent = new Map(roots.map((id) => [id, [] as string[]]));
  const degree = new Map(roots.map((id) => [id, 0]));
  for (const edge of projected) {
    adjacent.get(edge.source)?.push(edge.target);
    adjacent.get(edge.target)?.push(edge.source);
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const visited = new Set<string>();
  let largest: string[] = [];
  for (const root of roots) {
    if (visited.has(root)) continue;
    const pending = [root];
    const component: string[] = [];
    visited.add(root);
    let index = 0;
    while (index < pending.length) {
      const current = pending[index];
      index += 1;
      if (current === undefined) continue;
      component.push(current);
      for (const neighbor of adjacent.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const nodeIds = roots.filter((id) => largest.includes(id));
  const anchorNodeId = nodeIds.reduce<string | null>((best, id) => {
    if (best === null) return id;
    return (degree.get(id) ?? 0) > (degree.get(best) ?? 0) ? id : best;
  }, null);
  return { nodeIds, anchorNodeId };
}
