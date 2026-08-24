'use client';

/** Project-card adapter for the shared component-aware graph layout. */
import { type Edge, type Node, Position } from '@xyflow/react';
import { useMemo } from 'react';

import {
  graphLayoutStructureKey,
  type GraphLayoutResult,
  layoutMeasuredGraph,
} from './graph-layout-engine';
import { PROJECT_NODE_SIZE } from './project-node';

/** Positioned Project nodes and the diagnostics and framing metadata from their layout. */
export interface ProjectGraphLayout {
  /** Project cards with full-density positions and handles. */
  readonly nodes: Node[];
  /** Pure layout result for diagnostics and viewport framing. */
  readonly layout: GraphLayoutResult;
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
 * @param layoutEpoch - Explicit re-layout request counter.
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
 * @param nodes - Project cards in stable portfolio order.
 * @param edges - Project dependency edges.
 * @param aspectRatio - Coarse host viewport aspect used for component packing.
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
  const layout = useMemo(
    () => layoutMeasuredGraph(measured, edges, { direction: 'LR', aspectRatio }),
    [structureKey, layoutEpoch],
  );
  const positioned = useMemo(() => applyProjectGeometry(nodes, layout), [nodes, layout]);
  return { nodes: positioned, layout };
}
