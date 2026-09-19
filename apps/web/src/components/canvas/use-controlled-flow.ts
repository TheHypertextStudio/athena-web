'use client';

/**
 * `components/canvas/use-controlled-flow` — sync external graph data into xyflow's controlled state.
 *
 * @remarks
 * The graph is owned upstream (the feeder's query cache), but xyflow needs local controlled state
 * for drag/select. This hook holds that state and re-syncs it whenever the incoming graph actually
 * changes. It fires only on a genuine change (a structural+data signature), so a user's in-progress
 * pan/drag is never interrupted by an unrelated re-render.
 *
 * Two kinds of change reach xyflow differently. When the same set of nodes is merely rearranged
 * (a dependency added or removed, a re-layout), the positions are tweened in place by
 * {@link useAnimatedNodePositions} and nothing else on the page is touched. When nodes appear or
 * disappear, the swap runs inside a named-scope View Transition so cards with a stable
 * `view-transition-name` morph while the rest of the document keeps taking input.
 *
 * `useFitViewOnChange` is the companion for search-to-match: it pans/zooms to a set of node ids
 * using xyflow's own `fitView`, keyed so it only fires when the set changes.
 */
import {
  type Edge,
  type FitViewOptions,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { useEffect, useMemo, useRef } from 'react';

import { startViewTransition } from '@/lib/view-transition';

import { useAnimatedNodePositions } from './use-animated-node-positions';

/** The controlled xyflow state produced by {@link useControlledFlow}. */
export interface ControlledFlow {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  /** Whether xyflow state contains the latest incoming geometry and data. */
  layoutApplied: boolean;
}

/** How {@link useControlledFlow} applies a rearrangement of the same nodes. */
export interface ControlledFlowOptions {
  /**
   * Tween positions when the node set is unchanged. Pass `false` while the graph has not been
   * framed yet, so the first measured layout lands at once instead of delaying the first frame.
   */
  readonly animate?: boolean;
}

/** A structure, geometry, and data signature so layout-only changes reach xyflow state. */
function graphSignature(nodes: readonly Node[], edges: readonly Edge[]): string {
  return `${nodes
    .map(
      (node) =>
        `${node.id}:${node.type ?? ''}:${node.parentId ?? ''}:` +
        `${node.sourcePosition ?? ''},${node.targetPosition ?? ''}:` +
        `${node.position.x},${node.position.y}:` +
        `${String(node.style?.width ?? '')}x${String(node.style?.height ?? '')}:` +
        JSON.stringify(node.data),
    )
    .join('|')}::${edges.map((edge) => edge.id).join('|')}`;
}

/** Whether both arrays hold exactly the same node ids. */
function sameNodeIds(left: readonly Node[], right: readonly Node[]): boolean {
  if (left.length !== right.length) return false;
  const ids = new Set(left.map(({ id }) => id));
  return right.every(({ id }) => ids.has(id));
}

/** Carry the current selection onto the incoming nodes. */
function withRetainedSelection(current: readonly Node[], incoming: readonly Node[]): Node[] {
  const selectedIds = new Set(
    current.filter(({ selected }) => selected === true).map(({ id }) => id),
  );
  return incoming.map((node) =>
    selectedIds.has(node.id) && node.selected !== true ? { ...node, selected: true } : node,
  );
}

/**
 * Hold xyflow's controlled node/edge state, re-syncing when the incoming laid-out graph changes.
 *
 * @param laidOut - The positioned nodes from the layout pass.
 * @param rawEdges - The incoming edges.
 * @param options - See {@link ControlledFlowOptions}.
 * @returns the controlled state + change handlers to spread onto `<ReactFlow>`.
 */
export function useControlledFlow(
  laidOut: Node[],
  rawEdges: Edge[],
  options: ControlledFlowOptions = {},
): ControlledFlow {
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges);
  const animate = useAnimatedNodePositions(setNodes);
  const animateEnabled = options.animate ?? true;

  // Declared before the sync effect so the sync always reads the nodes of the latest commit.
  const liveNodes = useRef(nodes);
  useEffect(() => {
    liveNodes.current = nodes;
  }, [nodes]);
  const signature = useMemo(() => graphSignature(laidOut, rawEdges), [laidOut, rawEdges]);
  const prevSignature = useRef(signature);
  useEffect(() => {
    if (prevSignature.current === signature) return;
    prevSignature.current = signature;
    const current = liveNodes.current;
    const next = withRetainedSelection(current, laidOut);
    if (sameNodeIds(current, laidOut)) {
      setEdges(rawEdges);
      if (animateEnabled) {
        animate(current, next);
        return;
      }
      setNodes(next);
      return;
    }
    startViewTransition(
      () => {
        setNodes(next);
        setEdges(rawEdges);
      },
      { scope: 'named' },
    );
  }, [animate, animateEnabled, signature, laidOut, rawEdges, setNodes, setEdges]);

  const layoutApplied = graphSignature(nodes, edges) === signature;
  return { nodes, edges, onNodesChange, onEdgesChange, layoutApplied };
}

/**
 * Pan/zoom the viewport to fit `ids` whenever that set changes (e.g. search matches).
 *
 * @param ids - The node ids to bring into view, or undefined to leave the viewport alone.
 * @param maxZoom - The zoom ceiling for this fit. Shares the canvas's `fitMaxZoom` so narrowing a
 *   search to one node lands it at the same scale the graph opens at, rather than magnifying it to
 *   fill the viewport.
 * @param enabled - Whether measured layout and xyflow state are ready for viewport work.
 * @param padding - Space kept clear inside the visible graph viewport.
 */
export function useFitViewOnChange(
  ids: readonly string[] | undefined,
  maxZoom: number,
  enabled = true,
  padding: FitViewOptions['padding'] = 0.3,
): void {
  const { fitView } = useReactFlow();
  const key = ids?.join(',') ?? '';
  useEffect(() => {
    if (!enabled || ids === undefined || ids.length === 0) return;
    // Keyed on the joined id list (not the array identity); `fitView` is stable from the store.
    void fitView({ nodes: ids.map((id) => ({ id })), duration: 400, maxZoom, padding });
  }, [enabled, key, fitView, ids, maxZoom, padding]);
}
