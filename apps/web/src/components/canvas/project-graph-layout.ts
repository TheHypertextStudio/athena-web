'use client';

/** Project-card adapter for the shared component-aware graph layout. */
import { type Edge, type Node, Position } from '@xyflow/react';
import { useMemo, useRef } from 'react';

import {
  coarseGraphAspectRatio,
  graphLayoutStructureKey,
  type GraphLayoutResult,
  layoutMeasuredGraph,
} from './graph-layout-engine';
import { layoutMeasuredGraphIncrementally } from './graph-layout-incremental';
import { PROJECT_NODE_SIZE } from './project-node';

/** Positioned Project nodes and the diagnostics and framing metadata from their layout. */
export interface ProjectGraphLayout {
  /** Project cards with full-density positions and handles. */
  readonly nodes: Node[];
  /** Pure layout result for diagnostics and viewport framing. */
  readonly layout: GraphLayoutResult;
}

/** What the previous layout was computed for, so a change in either forces a full repack. */
interface LayoutFrame {
  readonly epoch: number;
  readonly coarseAspect: number;
}

/** Apply cached Project geometry to the latest card data. */
function applyProjectGeometry(nodes: readonly Node[], layout: GraphLayoutResult): Node[] {
  return nodes.map((node) => ({
    ...node,
    position: layout.positions.get(node.id) ?? { x: 0, y: 0 },
    style: { ...node.style, ...PROJECT_NODE_SIZE.full },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));
}

/**
 * Lay out fixed-size Project cards as independently packed dependency components.
 *
 * @param nodes - Project cards in stable portfolio order.
 * @param edges - Project dependency edges.
 * @param aspectRatio - Coarse host viewport aspect used for component packing.
 * @returns positioned Project cards and the shared layout result.
 */
export function layoutProjectGraph(
  nodes: readonly Node[],
  edges: readonly Edge[],
  aspectRatio: number,
): ProjectGraphLayout {
  const layout = layoutMeasuredGraph(
    nodes.map(({ id }) => ({ id, ...PROJECT_NODE_SIZE.full })),
    edges,
    { direction: 'LR', aspectRatio },
  );
  return {
    nodes: applyProjectGeometry(nodes, layout),
    layout,
  };
}

/**
 * Memoize Project geometry from structural inputs and apply it to current Project properties.
 *
 * @remarks
 * The first layout, an explicit re-layout (`layoutEpoch`), and a change of coarse aspect bucket
 * run the full engine and repack every component. Every other structural change (a dependency
 * added or removed, a Project appearing or leaving) is laid out against the previous result so
 * untouched components keep their geometry and the packing keeps its row count and order.
 *
 * @param nodes - Project cards in stable portfolio order.
 * @param edges - Project dependency edges.
 * @param aspectRatio - Coarse host viewport aspect used for component packing.
 * @param layoutEpoch - Explicit re-layout request counter.
 * @returns positioned Project cards and the shared cached layout result.
 */
export function useProjectGraphLayout(
  nodes: readonly Node[],
  edges: readonly Edge[],
  aspectRatio: number,
  layoutEpoch = 0,
): ProjectGraphLayout {
  const measured = nodes.map(({ id }) => ({ id, ...PROJECT_NODE_SIZE.full }));
  const structureKey = graphLayoutStructureKey(measured, edges, 'LR', aspectRatio);
  const previous = useRef<GraphLayoutResult | null>(null);
  const frame = useRef<LayoutFrame | null>(null);
  const layout = useMemo(() => {
    const options = { direction: 'LR' as const, aspectRatio };
    const nextFrame: LayoutFrame = {
      epoch: layoutEpoch,
      coarseAspect: coarseGraphAspectRatio(aspectRatio),
    };
    const base = previous.current;
    const sameFrame =
      frame.current !== null &&
      frame.current.epoch === nextFrame.epoch &&
      frame.current.coarseAspect === nextFrame.coarseAspect;
    const next =
      base !== null && sameFrame
        ? layoutMeasuredGraphIncrementally(measured, edges, options, base)
        : layoutMeasuredGraph(measured, edges, options);
    previous.current = next;
    frame.current = nextFrame;
    return next;
  }, [structureKey, layoutEpoch]);
  const positioned = useMemo(() => applyProjectGeometry(nodes, layout), [nodes, layout]);
  return { nodes: positioned, layout };
}
