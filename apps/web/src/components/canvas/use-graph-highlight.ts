'use client';

/**
 * `components/canvas/use-graph-highlight` — hover / selection / highlight emphasis.
 *
 * @remarks
 * Keeps this concern out of `Canvas`. Selection is read from xyflow itself
 * (`useOnSelectionChange`) rather than threaded as a prop, and hover is the only local state we
 * actually own. Returns the (className-decorated) nodes/edges plus the two hover handlers to
 * spread onto `<ReactFlow>`.
 *
 * ## Three tiers, not two
 *
 * Hovering a node used to drop everything off its dependency chain to 20% opacity, which erased
 * the rest of the graph rather than de-emphasizing it — an unrelated task read as a rendering
 * artifact. Emphasis now runs in three tiers instead:
 *
 * - **Adjacent** — the hovered node, its immediate blockers/blocked-by, and the edges joining
 *   them. Lifted: full opacity, and the edge is drawn thicker in the primary colour.
 * - **Chain** — the rest of the transitive closure. Left exactly as it renders normally, because
 *   this is the answer to "what does this touch" and it should stay readable.
 * - **Unrelated** — everything else. Softened to 55%, which reads as background without
 *   disappearing.
 *
 * A persistent `highlightIds` set (the critical path) keeps the older two-tier behaviour, since
 * there the point *is* to isolate a subgraph, but it softens to the same 55%.
 *
 * ## Hover intent
 *
 * The tiers engage after {@link HOVER_ENTER_DELAY_MS} and release after
 * {@link HOVER_LEAVE_DELAY_MS}, so dragging the pointer across a dense graph no longer strobes the
 * whole canvas on the way to somewhere else.
 */
import { type Edge, type Node, useOnSelectionChange } from '@xyflow/react';
import { cn } from '@docket/ui/lib/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type Adjacency, buildAdjacency } from './graph-adjacency';

/** How long the pointer must rest on a node before the emphasis engages. */
const HOVER_ENTER_DELAY_MS = 120;
/** How long the emphasis persists after the pointer leaves, so a near-miss does not flicker. */
const HOVER_LEAVE_DELAY_MS = 200;

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

/** `id` plus its immediate neighbours in both directions (one hop only). */
function adjacentIds(id: string, adjacency: Adjacency): Set<string> {
  const near = new Set<string>([id]);
  for (const next of adjacency.out.get(id) ?? []) near.add(next);
  for (const next of adjacency.in.get(id) ?? []) near.add(next);
  return near;
}

/** Softened, not erased: an unrelated node still reads as a node. */
const SOFT_CLASS = 'opacity-55 transition-opacity duration-200';
/** The lifted tier — a node one hop from the hovered one. */
const LIFT_NODE_CLASS = 'z-10 transition-opacity duration-200';
/** The lifted tier for an edge: thicker and in the primary colour. */
const LIFT_EDGE_CLASS = '[&_.react-flow__edge-path]:!stroke-primary';

/** The highlight hook result: decorated graph + hover handlers for `<ReactFlow>`. */
export interface GraphHighlight {
  /** Nodes with emphasis classes applied. */
  nodes: Node[];
  /** Edges with emphasis classes applied. */
  edges: Edge[];
  /** `onNodeMouseEnter` handler. */
  onNodeMouseEnter: (event: unknown, node: Node) => void;
  /** `onNodeMouseLeave` handler. */
  onNodeMouseLeave: () => void;
}

/** Which emphasis tier an element falls into for the active node. */
type Tier = 'lift' | 'chain' | 'soft';

/** Decorate nodes/edges per tier; `chain` elements pass through by identity so xyflow skips them. */
function applyTiers(
  nodes: readonly Node[],
  edges: readonly Edge[],
  nodeTier: (id: string) => Tier,
  edgeTier: (source: string, target: string) => Tier,
): { nodes: Node[]; edges: Edge[] } {
  const decorate = <T extends { className?: string }>(el: T, tier: Tier, lift: string): T => {
    if (tier === 'chain') return el;
    return { ...el, className: cn(el.className, tier === 'soft' ? SOFT_CLASS : lift) };
  };
  return {
    nodes: nodes.map((n) => decorate(n, nodeTier(n.id), LIFT_NODE_CLASS)),
    edges: edges.map((e) => decorate(e, edgeTier(e.source, e.target), LIFT_EDGE_CLASS)),
  };
}

/**
 * Emphasize the hovered/selected node's immediate neighbourhood, or isolate a persistent set.
 *
 * @param nodes - The laid-out nodes.
 * @param edges - The edges.
 * @param highlightIds - A persistent set to keep lit when nothing is hovered/selected, or null.
 * @param highlightChains - When false, hovering/selecting a node no longer re-tiers the graph
 *   (the persistent `highlightIds` set is still honored). Defaults to true.
 * @returns the decorated graph + hover handlers.
 */
export function useGraphHighlight(
  nodes: Node[],
  edges: Edge[],
  highlightIds: Set<string> | null | undefined,
  highlightChains = true,
): GraphHighlight {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback((next: string | null, delay: number) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHoverId(next);
    }, delay);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  // Selection is xyflow's own state — read it rather than threading a prop through the host.
  useOnSelectionChange({
    onChange: useCallback(({ nodes: selected }: { nodes: Node[] }) => {
      setSelectedId(selected[0]?.id ?? null);
    }, []),
  });

  const onNodeMouseEnter = useCallback(
    (_event: unknown, node: Node) => {
      schedule(node.id, HOVER_ENTER_DELAY_MS);
    },
    [schedule],
  );
  const onNodeMouseLeave = useCallback(() => {
    schedule(null, HOVER_LEAVE_DELAY_MS);
  }, [schedule]);

  // Adjacency depends only on edges, so it is rebuilt on a graph change — not on every hover.
  const adjacency = useMemo(() => buildAdjacency(edges), [edges]);

  const active = highlightChains ? (hoverId ?? selectedId) : null;
  const decorated = useMemo(() => {
    if (active !== null) {
      const chain = relatedIds(active, adjacency);
      const near = adjacentIds(active, adjacency);
      const tierOf = (id: string): Tier => {
        if (near.has(id)) return 'lift';
        return chain.has(id) ? 'chain' : 'soft';
      };
      return applyTiers(nodes, edges, tierOf, (s, t) => {
        if (near.has(s) && near.has(t)) return 'lift';
        return chain.has(s) && chain.has(t) ? 'chain' : 'soft';
      });
    }
    if (highlightIds && highlightIds.size > 0) {
      const tierOf = (id: string): Tier => (highlightIds.has(id) ? 'chain' : 'soft');
      return applyTiers(nodes, edges, tierOf, (s, t) =>
        highlightIds.has(s) && highlightIds.has(t) ? 'chain' : 'soft',
      );
    }
    return { nodes, edges };
  }, [nodes, edges, active, adjacency, highlightIds]);

  return { ...decorated, onNodeMouseEnter, onNodeMouseLeave };
}
