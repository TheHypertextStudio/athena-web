'use client';

/**
 * `components/plan-canvas/plan-layout` — positioning a plan's cards, containers, and rows.
 *
 * @remarks
 * Two levels. Inside a project container the task rows stack top to bottom in document order,
 * because a container reads as a list and a list has one axis. At the top level the initiative
 * cards and the project containers are measured rectangles handed to the shared component-aware
 * engine, with every edge projected to its top-level owner, so the initiative sits to the left of
 * the projects it links to and dependent projects follow one another left to right — the same
 * packing the Project graph uses, so the two canvases read alike.
 */
import type { Edge, Node } from '@xyflow/react';
import { Position } from '@xyflow/react';
import { useMemo, useRef } from 'react';

import {
  graphLayoutStructureKey,
  layoutMeasuredGraph,
  projectGraphEdges,
  type GraphLayoutResult,
  type MeasuredGraphNode,
} from '@/components/canvas/graph-layout-engine';

import {
  PLAN_INITIATIVE_SIZE,
  PLAN_NODE_TYPE,
  PLAN_PROJECT_FOOTER,
  PLAN_PROJECT_HEADER,
  PLAN_PROJECT_PADDING,
  PLAN_PROJECT_WIDTH,
  PLAN_TASK_GAP,
  PLAN_TASK_SIZE,
  type PlanProjectNodeData,
} from './plan-nodes';

/** A positioned plan and the layout result the viewport frames from. */
export interface PlanLayout {
  readonly nodes: Node[];
  readonly layout: GraphLayoutResult;
}

/** The height a container needs for its rows and, when editable, its Add task row. */
export function projectContainerHeight(taskCount: number, canAddTask: boolean): number {
  const rows = taskCount * PLAN_TASK_SIZE.height + Math.max(0, taskCount - 1) * PLAN_TASK_GAP;
  const footer = canAddTask ? PLAN_PROJECT_FOOTER : 0;
  return PLAN_PROJECT_HEADER + PLAN_PROJECT_PADDING + rows + footer + PLAN_PROJECT_PADDING;
}

/** Group task rows under their container, in document order. */
function tasksByProject(nodes: readonly Node[]): Map<string, Node[]> {
  const grouped = new Map<string, Node[]>();
  for (const node of nodes) {
    if (node.type !== PLAN_NODE_TYPE.task || node.parentId === undefined) continue;
    const list = grouped.get(node.parentId) ?? [];
    list.push(node);
    grouped.set(node.parentId, list);
  }
  return grouped;
}

/** The measured rectangle for one top-level node. */
function measure(node: Node, taskCount: number): MeasuredGraphNode {
  if (node.type === PLAN_NODE_TYPE.project) {
    const data = node.data as PlanProjectNodeData;
    return {
      id: node.id,
      width: PLAN_PROJECT_WIDTH,
      height: projectContainerHeight(taskCount, data.canAddTask),
    };
  }
  return { id: node.id, ...PLAN_INITIATIVE_SIZE };
}

/**
 * Lay out a projected plan.
 *
 * @param nodes - Unpositioned nodes from `projectPlan`, parents first.
 * @param edges - The link and dependency edges.
 * @param aspectRatio - Coarse host viewport aspect used for component packing.
 * @returns positioned nodes and the layout result.
 */
export function layoutPlan(
  nodes: readonly Node[],
  edges: readonly Edge[],
  aspectRatio: number,
): PlanLayout {
  const grouped = tasksByProject(nodes);
  const topLevel = nodes.filter((node) => node.type !== PLAN_NODE_TYPE.task);
  const measured = topLevel.map((node) => measure(node, grouped.get(node.id)?.length ?? 0));
  const measuredById = new Map(measured.map((entry) => [entry.id, entry]));

  const owner = new Map<string, string>();
  for (const node of nodes) owner.set(node.id, node.parentId ?? node.id);
  const projected = projectGraphEdges(edges, owner);
  const layout = layoutMeasuredGraph(measured, projected, { direction: 'LR', aspectRatio });

  const positioned: Node[] = topLevel.map((node) => {
    const size = measuredById.get(node.id);
    return {
      ...node,
      position: layout.positions.get(node.id) ?? { x: 0, y: 0 },
      style: { ...node.style, width: size?.width, height: size?.height },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
  for (const [projectId, rows] of grouped) {
    rows.forEach((row, index) => {
      positioned.push({
        ...row,
        parentId: projectId,
        extent: 'parent',
        position: {
          x: (PLAN_PROJECT_WIDTH - PLAN_TASK_SIZE.width) / 2,
          y:
            PLAN_PROJECT_HEADER +
            PLAN_PROJECT_PADDING +
            index * (PLAN_TASK_SIZE.height + PLAN_TASK_GAP),
        },
        style: { ...row.style, ...PLAN_TASK_SIZE },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    });
  }
  return { nodes: positioned, layout };
}

/** The memo key: structure only, so a field edit never re-packs the graph. */
function planStructureKey(nodes: readonly Node[], edges: readonly Edge[], aspect: number): string {
  const grouped = tasksByProject(nodes);
  const measured = nodes
    .filter((node) => node.type !== PLAN_NODE_TYPE.task)
    .map((node) => measure(node, grouped.get(node.id)?.length ?? 0));
  const rows = [...grouped.entries()].map(
    ([id, list]) => `${id}:${list.map((n) => n.id).join('+')}`,
  );
  return `${graphLayoutStructureKey(measured, edges, 'LR', aspect)}|${rows.join(';')}`;
}

/**
 * Lay out a plan, re-packing only when its structure changes.
 *
 * @param nodes - Unpositioned nodes from `projectPlan`.
 * @param edges - The link and dependency edges.
 * @param aspectRatio - Coarse host viewport aspect.
 * @param epoch - Explicit re-layout counter from the viewport toolbar.
 * @returns positioned nodes and the layout result.
 */
export function usePlanLayout(
  nodes: readonly Node[],
  edges: readonly Edge[],
  aspectRatio: number,
  epoch: number,
): PlanLayout {
  const structureKey = planStructureKey(nodes, edges, aspectRatio);
  // The geometry is memoised on structure and the explicit re-layout epoch; the current node
  // data is re-applied on every render so a renamed or highlighted node updates without moving.
  const latest = useRef({ nodes, edges, aspectRatio });
  latest.current = { nodes, edges, aspectRatio };
  const geometry = useMemo(() => {
    const input = latest.current;
    return layoutPlan(input.nodes, input.edges, input.aspectRatio);
  }, [structureKey, epoch]);
  return useMemo(() => {
    const byId = new Map(geometry.nodes.map((node) => [node.id, node]));
    return {
      layout: geometry.layout,
      nodes: nodes
        .map((node) => {
          const placed = byId.get(node.id);
          return placed ? { ...placed, data: node.data } : null;
        })
        .filter((node): node is Node => node !== null),
    };
  }, [geometry, nodes]);
}
