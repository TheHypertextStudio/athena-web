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
}

/** A structural+data signature so we re-sync only when the graph genuinely changes. */
function graphSignature(nodes: readonly Node[], edges: readonly Edge[]): string {
  return `${nodes.map((n) => `${n.id}:${JSON.stringify(n.data)}`).join('|')}::${edges
    .map((e) => e.id)
    .join('|')}`;
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
      setNodes(laidOut);
      setEdges(rawEdges);
    });
  }, [signature, laidOut, rawEdges, setNodes, setEdges]);

  return { nodes, edges, onNodesChange, onEdgesChange };
}

/** Pan/zoom the viewport to fit `ids` whenever that set changes (e.g. search matches). */
export function useFitViewOnChange(ids: readonly string[] | undefined): void {
  const { fitView } = useReactFlow();
  const key = ids?.join(',') ?? '';
  useEffect(() => {
    if (ids === undefined || ids.length === 0) return;
    // Keyed on the joined id list (not the array identity); `fitView` is stable from the store.
    void fitView({ nodes: ids.map((id) => ({ id })), duration: 400, maxZoom: 1.2, padding: 0.3 });
  }, [key, fitView, ids]);
}
