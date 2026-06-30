/**
 * `components/canvas/use-dagre-layout` — assign node positions with a layered DAG layout.
 *
 * @remarks
 * `@xyflow/react` ships no layout engine, so we run `dagre` to place nodes left-to-right by
 * rank. The combined edge set (dependency ∪ subtask) is fed to dagre as one directed graph;
 * dagre breaks any incidental cycle introduced by mixing the two edge kinds. Positions are
 * memoized on the graph *structure* (node ids + edge endpoints + density) so node-data
 * refreshes (a renamed title, a changed state) reuse the existing layout instead of
 * reshuffling the canvas.
 */
import { type Edge, type Node, Position } from '@xyflow/react';
import dagre from 'dagre';
import { useMemo } from 'react';

/** Rendered node box size per density, used both for layout spacing and node CSS. */
export const NODE_SIZE = {
  full: { width: 224, height: 64 },
  compact: { width: 184, height: 44 },
} as const;

/** Canvas density: `compact` for small embeds, `full` for the focused view. */
export type CanvasDensity = keyof typeof NODE_SIZE;

/** Compute `{x,y}` for every node id via dagre (left-to-right, layered). */
function computePositions(
  nodes: readonly Node[],
  edges: readonly Edge[],
  density: CanvasDensity,
): Record<string, { x: number; y: number }> {
  const { width, height } = NODE_SIZE[density];
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: density === 'compact' ? 22 : 36,
    ranksep: density === 'compact' ? 64 : 96,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width, height });
  for (const e of edges) {
    // Guard against edges to/from nodes not in the set (defensive; the API pre-prunes).
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = g.node(n.id);
    // dagre centers nodes; xyflow positions by top-left, so shift by half the box.
    positions[n.id] = { x: p.x - width / 2, y: p.y - height / 2 };
  }
  return positions;
}

/**
 * Lay out `nodes` with dagre and return them positioned, with handles on the left/right to
 * match the left-to-right rank flow.
 *
 * @param nodes - The unpositioned nodes.
 * @param edges - The directed edges driving the layout.
 * @param density - The canvas density.
 * @returns the nodes with `position`/`sourcePosition`/`targetPosition` set.
 */
export function useDagreLayout(
  nodes: readonly Node[],
  edges: readonly Edge[],
  density: CanvasDensity,
): Node[] {
  // Structure key: only re-run dagre when the graph shape (not node data) changes.
  const structureKey = useMemo(
    () =>
      `${density}|${nodes
        .map((n) => n.id)
        .sort()
        .join(',')}|${edges
        .map((e) => `${e.source}>${e.target}`)
        .sort()
        .join(',')}`,
    [nodes, edges, density],
  );

  // Keyed on `structureKey` (not the raw arrays) on purpose: re-running dagre on node-data
  // churn would needlessly reshuffle the canvas. `structureKey` is derived from `nodes`,
  // `edges`, and `density`, so it captures every layout-relevant input.
  const positions = useMemo(() => computePositions(nodes, edges, density), [structureKey]);

  return useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        position: positions[n.id] ?? { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      })),
    [nodes, positions],
  );
}
