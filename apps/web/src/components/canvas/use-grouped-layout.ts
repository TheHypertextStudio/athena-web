/**
 * `components/canvas/use-grouped-layout` — swimlane layout (dagre per group, packed into lanes).
 *
 * @remarks
 * xyflow's `parentId` grouping does NOT compose with dagre (dagre lays out a flat graph, unaware of
 * parent extents), so grouping is done here manually: partition nodes by a group key, run dagre on
 * each group's subgraph independently, pack the groups into stacked lanes, and emit a `group`
 * container node per lane plus the task nodes reparented into it (positions relative to the
 * container, `extent: 'parent'`). Cross-group edges still render fine — xyflow draws edges between
 * child nodes across parents. Parents precede children in the returned array (an xyflow requirement).
 */
import { type Edge, type Node, Position } from '@xyflow/react';
import dagre from 'dagre';

import { type CanvasDensity, type LayoutDirection, NODE_SIZE } from './use-dagre-layout';

/** Padding inside a group container, header band height, and gap between lanes (px). */
const GROUP_PADDING = 20;
const GROUP_HEADER = 30;
const LANE_GAP = 40;

/** The id used for the implicit "no group key" lane. */
const UNGROUPED = '__ungrouped__';

/** How the host classifies + labels nodes for grouping. */
export interface GroupSpec {
  /** The group id for a node, or null to place it in the "Ungrouped" lane. */
  groupOf: (node: Node) => string | null;
  /** A display label for a group id. */
  labelOf: (groupId: string) => string;
}

/** Lay out `nodes` as swimlanes by `spec`, returning group containers + reparented task nodes. */
export function layoutGrouped(
  nodes: readonly Node[],
  edges: readonly Edge[],
  density: CanvasDensity,
  direction: LayoutDirection,
  spec: GroupSpec,
): Node[] {
  const { width, height } = NODE_SIZE[density];
  const isLR = direction === 'LR';

  // Partition nodes by group key (stable insertion order).
  const groups = new Map<string, Node[]>();
  for (const n of nodes) {
    const key = spec.groupOf(n) ?? UNGROUPED;
    const bucket = groups.get(key);
    if (bucket) bucket.push(n);
    else groups.set(key, [n]);
  }

  const groupNodes: Node[] = [];
  const childNodes: Node[] = [];
  let laneOffset = 0;

  for (const [groupId, members] of groups) {
    const ids = new Set(members.map((n) => n.id));
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, nodesep: 22, ranksep: 80 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of members) g.setNode(n.id, { width, height });
    for (const e of edges) {
      if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
    }
    dagre.layout(g);

    // Local (group-relative) positions + bounding box.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const local = new Map<string, { x: number; y: number }>();
    for (const n of members) {
      const p = g.node(n.id);
      const x = p.x - width / 2;
      const y = p.y - height / 2;
      local.set(n.id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = width;
      maxY = height;
    }

    const groupW = maxX - minX + GROUP_PADDING * 2;
    const groupH = maxY - minY + GROUP_PADDING * 2 + GROUP_HEADER;
    // Lanes stack along the cross-axis of the flow (rows for LR, columns for TB).
    const position = isLR ? { x: 0, y: laneOffset } : { x: laneOffset, y: 0 };
    laneOffset += (isLR ? groupH : groupW) + LANE_GAP;

    groupNodes.push({
      id: `group:${groupId}`,
      type: 'group',
      position,
      data: { label: groupId === UNGROUPED ? 'Ungrouped' : spec.labelOf(groupId) },
      style: { width: groupW, height: groupH },
      selectable: false,
      draggable: false,
      zIndex: -1,
    });

    for (const n of members) {
      const l = local.get(n.id) ?? { x: 0, y: 0 };
      childNodes.push({
        ...n,
        parentId: `group:${groupId}`,
        extent: 'parent',
        position: {
          x: l.x - minX + GROUP_PADDING,
          y: l.y - minY + GROUP_PADDING + GROUP_HEADER,
        },
        sourcePosition: isLR ? Position.Right : Position.Bottom,
        targetPosition: isLR ? Position.Left : Position.Top,
      });
    }
  }

  return [...groupNodes, ...childNodes];
}
