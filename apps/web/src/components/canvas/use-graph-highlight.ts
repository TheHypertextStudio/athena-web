'use client';

/**
 * `components/canvas/use-graph-highlight` — hover / selection / highlight dimming.
 *
 * @remarks
 * Keeps this concern out of `Canvas`. Selection is read from xyflow itself
 * (`useOnSelectionChange`) rather than threaded as a prop, and hover is the only local state we
 * actually own. When a node is hovered or selected its connected chain stays lit and everything
 * else fades; otherwise, when a persistent `highlightIds` set is supplied (e.g. the critical
 * path), everything off that set fades. Returns the (className-decorated) nodes/edges plus the two
 * hover handlers to spread onto `<ReactFlow>`.
 */
import { type Edge, type Node, useOnSelectionChange } from '@xyflow/react';
import { cn } from '@docket/ui/lib/utils';
import { useCallback, useMemo, useState } from 'react';

import { type Adjacency, buildAdjacency } from './graph-adjacency';

/** All node ids reachable from `id` along edges in either direction (its dependency chain). */
function relatedIds(id: string, adjacency: Adjacency): Set<string> {
  const seen = new Set<string>([id]);
  const walk = (adj: Map<string, string[]>): void => {
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined) continue;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
  };
  walk(adjacency.out);
  walk(adjacency.in);
  return seen;
}

/** The Tailwind classes applied to a faded node/edge. */
const DIM_CLASS = 'opacity-20 transition-opacity duration-200';

/**
 * Decorate excluded nodes/edges with the dim class; kept ones pass through *by identity* so
 * xyflow skips re-rendering them (only the faded elements get new objects).
 */
function applyDim(
  nodes: readonly Node[],
  edges: readonly Edge[],
  keepNode: (id: string) => boolean,
  keepEdge: (source: string, target: string) => boolean,
): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: nodes.map((n) => (keepNode(n.id) ? n : { ...n, className: cn(n.className, DIM_CLASS) })),
    edges: edges.map((e) =>
      keepEdge(e.source, e.target) ? e : { ...e, className: cn(e.className, DIM_CLASS) },
    ),
  };
}

/** The highlight hook result: decorated graph + hover handlers for `<ReactFlow>`. */
export interface GraphHighlight {
  /** Nodes with dim classes applied. */
  nodes: Node[];
  /** Edges with dim classes applied. */
  edges: Edge[];
  /** `onNodeMouseEnter` handler. */
  onNodeMouseEnter: (event: unknown, node: Node) => void;
  /** `onNodeMouseLeave` handler. */
  onNodeMouseLeave: () => void;
}

/**
 * Dim nodes/edges off the hovered/selected node's chain, or off a persistent highlight set.
 *
 * @param nodes - The laid-out nodes.
 * @param edges - The edges.
 * @param highlightIds - A persistent set to keep lit when nothing is hovered/selected, or null.
 * @returns the decorated graph + hover handlers.
 */
export function useGraphHighlight(
  nodes: Node[],
  edges: Edge[],
  highlightIds: Set<string> | null | undefined,
): GraphHighlight {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Selection is xyflow's own state — read it rather than threading a prop through the host.
  useOnSelectionChange({
    onChange: useCallback(({ nodes: selected }: { nodes: Node[] }) => {
      setSelectedId(selected[0]?.id ?? null);
    }, []),
  });

  const onNodeMouseEnter = useCallback((_event: unknown, node: Node) => {
    setHoverId(node.id);
  }, []);
  const onNodeMouseLeave = useCallback(() => {
    setHoverId(null);
  }, []);

  // Adjacency depends only on edges, so it is rebuilt on a graph change — not on every hover.
  const adjacency = useMemo(() => buildAdjacency(edges), [edges]);

  const active = hoverId ?? selectedId;
  const decorated = useMemo(() => {
    if (active !== null) {
      const related = relatedIds(active, adjacency);
      return applyDim(
        nodes,
        edges,
        (id) => related.has(id),
        (s, t) => related.has(s) && related.has(t),
      );
    }
    if (highlightIds && highlightIds.size > 0) {
      return applyDim(
        nodes,
        edges,
        (id) => highlightIds.has(id),
        (s, t) => highlightIds.has(s) && highlightIds.has(t),
      );
    }
    return { nodes, edges };
  }, [nodes, edges, active, adjacency, highlightIds]);

  return { ...decorated, onNodeMouseEnter, onNodeMouseLeave };
}
