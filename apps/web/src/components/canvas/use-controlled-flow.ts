'use client';

/**
 * `components/canvas/use-controlled-flow` — sync external graph data into xyflow's controlled state.
 *
 * @remarks
 * The graph is owned upstream (the feeder's query cache), but xyflow needs local controlled state
 * for drag/select. This hook holds that state and re-syncs it whenever the incoming graph actually
 * changes — inside a View Transition so shared nodes (stable `view-transition-name`) morph between
 * arrangements rather than hard-swapping. It fires only on a genuine change (a structural+data
 * signature), so a user's in-progress pan/drag is never interrupted by an unrelated re-render.
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

/** The controlled xyflow state produced by {@link useControlledFlow}. */
export interface ControlledFlow {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  /** Whether xyflow state contains the latest incoming geometry and data. */
  layoutApplied: boolean;
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

/**
 * Hold xyflow's controlled node/edge state, re-syncing (via a View Transition) when the incoming
 * laid-out graph changes.
 *
 * @param laidOut - The positioned nodes from the layout pass.
 * @param rawEdges - The incoming edges.
 * @returns the controlled state + change handlers to spread onto `<ReactFlow>`.
 */
export function useControlledFlow(laidOut: Node[], rawEdges: Edge[]): ControlledFlow {
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges);

  const signature = useMemo(() => graphSignature(laidOut, rawEdges), [laidOut, rawEdges]);
  const prevSignature = useRef(signature);
  useEffect(() => {
    if (prevSignature.current === signature) return;
    prevSignature.current = signature;
    startViewTransition(() => {
      setNodes((current) => {
        const selectedIds = new Set(
          current.filter(({ selected }) => selected === true).map(({ id }) => id),
        );
        return laidOut.map((node) =>
          selectedIds.has(node.id) && node.selected !== true ? { ...node, selected: true } : node,
        );
      });
      setEdges(rawEdges);
    });
  }, [signature, laidOut, rawEdges, setNodes, setEdges]);

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
