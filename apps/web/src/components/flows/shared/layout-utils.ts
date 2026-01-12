/**
 * Layout utilities for ReactFlow graphs using dagre.
 *
 * @packageDocumentation
 */

import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

export interface LayoutOptions {
  direction?: 'TB' | 'BT' | 'LR' | 'RL';
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
}

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  direction: 'TB',
  nodeWidth: 180,
  nodeHeight: 60,
  rankSep: 80,
  nodeSep: 40,
};

/**
 * Apply dagre layout to nodes and edges.
 * Returns new nodes with calculated positions.
 */
export function getLayoutedElements<T extends Node = Node, E extends Edge = Edge>(
  nodes: T[],
  edges: E[],
  options: LayoutOptions = {},
): { nodes: T[]; edges: E[] } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dagreGraph = new dagre.graphlib.Graph();

  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: opts.direction,
    ranksep: opts.rankSep,
    nodesep: opts.nodeSep,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: opts.nodeWidth,
      height: opts.nodeHeight,
    });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const position = {
      x: nodeWithPosition.x - opts.nodeWidth / 2,
      y: nodeWithPosition.y - opts.nodeHeight / 2,
    };

    return {
      ...node,
      position,
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * Calculate the bounding box of all nodes.
 */
export function getGraphBounds(nodes: Node[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    const x = node.position.x;
    const y = node.position.y;
    const width = node.measured?.width ?? 180;
    const height = node.measured?.height ?? 60;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Group nodes by a category field for swim lane layouts.
 */
export function groupNodesByCategory<T extends Node & { data: { category?: string } }>(
  nodes: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  nodes.forEach((node) => {
    const category = node.data.category ?? 'uncategorized';
    const existing = groups.get(category) ?? [];
    groups.set(category, [...existing, node]);
  });

  return groups;
}

/**
 * Apply horizontal swim lane layout (for workflow builder).
 */
export function getSwimLaneLayout<T extends Node & { data: { category?: string } }>(
  nodes: T[],
  categoryOrder: string[],
  options: {
    laneWidth?: number;
    laneGap?: number;
    nodeHeight?: number;
    nodeGap?: number;
    startX?: number;
    startY?: number;
  } = {},
): T[] {
  const {
    laneWidth = 200,
    laneGap = 40,
    nodeHeight = 60,
    nodeGap = 20,
    startX = 40,
    startY = 100,
  } = options;

  const groups = groupNodesByCategory(nodes);
  const layoutedNodes: T[] = [];

  categoryOrder.forEach((category, laneIndex) => {
    const laneNodes = groups.get(category) ?? [];
    const laneX = startX + laneIndex * (laneWidth + laneGap);

    laneNodes.forEach((node, nodeIndex) => {
      layoutedNodes.push({
        ...node,
        position: {
          x: laneX + (laneWidth - 160) / 2,
          y: startY + nodeIndex * (nodeHeight + nodeGap),
        },
      });
    });
  });

  return layoutedNodes;
}
