'use client';

/**
 * `components/plan-canvas/plan-layout` — positioning a plan's cards, containers, and rows.
 *
 * @remarks
 * A plan reads as a board, not as a dependency graph. Ranking projects left to right by their
 * dependencies, the way the Task graph ranks tasks, turns a three-project plan into a frame four
 * columns wide that only fits at half scale, and the first thing a person sees is unreadable.
 *
 * So the board has two orientations. In a landscape host the initiative cards stand in a column on
 * the left and the project containers stack in document order in short columns beside them. In a
 * portrait host the initiative cards sit in a row on top and the containers run down a single
 * column beneath, so a phone shows the whole plan at full scale and the person scrolls it like a
 * page. Either way each container is sized to the task rows it holds, membership links run from
 * the initiative into a container's header, and dependencies run from a container's bottom edge
 * into the next container's top edge, so a sequence still reads as a sequence without spending
 * width on it. The geometry is memoised on structure, so a field edit never moves anything.
 */
import type { Edge, Node } from '@xyflow/react';
import { Position } from '@xyflow/react';
import { useMemo, useRef } from 'react';

import {
  PLAN_EDGE_TYPE,
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

/** Gap between the initiative column and the first project column. */
const INITIATIVE_GUTTER = 96;
/** Gap between the initiative row and the first container in a portrait board. */
const INITIATIVE_ROW_GUTTER = 56;
/** Gap between project columns. */
const COLUMN_GAP = 56;
/** Vertical gap between stacked containers, and between stacked initiative cards. */
const STACK_GAP = 28;
/**
 * The most containers one column holds before the next column opens. A plan that spans more
 * than one column is also the plan that earns a minimap.
 */
export const PLAN_MAX_PER_COLUMN = 4;

/** Which way the board runs: containers beside the initiative, or beneath it. */
export type PlanOrientation = 'row' | 'column';

/** The container handle a membership link lands on, per orientation. */
export const PLAN_LINK_HANDLE: Record<PlanOrientation, string> = {
  row: 'link',
  column: 'link-top',
};

/** A positioned plan. */
export interface PlanLayout {
  readonly nodes: Node[];
  /** The packed extent, for diagnostics and framing. */
  readonly bounds: { readonly width: number; readonly height: number };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
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

/** How many containers each column holds: balanced, and never more than the column cap. */
function rowsPerColumn(count: number, orientation: PlanOrientation): number {
  if (count === 0 || orientation === 'column') return Math.max(1, count);
  const columns = Math.ceil(count / PLAN_MAX_PER_COLUMN);
  return Math.ceil(count / columns);
}

/** Stack the project containers into columns; returns each container's rectangle. */
function stackProjects(
  projects: readonly Node[],
  grouped: ReadonlyMap<string, Node[]>,
  orientation: PlanOrientation,
): { rects: Map<string, Rect>; height: number; width: number } {
  const rects = new Map<string, Rect>();
  const perColumn = rowsPerColumn(projects.length, orientation);
  let columnHeight = 0;
  let tallest = 0;
  projects.forEach((node, index) => {
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    if (row === 0) {
      tallest = Math.max(tallest, columnHeight);
      columnHeight = 0;
    }
    const data = node.data as PlanProjectNodeData;
    const height = projectContainerHeight(grouped.get(node.id)?.length ?? 0, data.canAddTask);
    rects.set(node.id, {
      x: column * (PLAN_PROJECT_WIDTH + COLUMN_GAP),
      y: columnHeight,
      width: PLAN_PROJECT_WIDTH,
      height,
    });
    columnHeight += height + STACK_GAP;
  });
  tallest = Math.max(tallest, columnHeight);
  const columns = projects.length === 0 ? 0 : Math.ceil(projects.length / perColumn);
  return {
    rects,
    height: Math.max(0, tallest - STACK_GAP),
    width: columns === 0 ? 0 : columns * PLAN_PROJECT_WIDTH + (columns - 1) * COLUMN_GAP,
  };
}

/** Where the initiative cards and the container stack sit relative to each other. */
function placeBoard(
  initiativeCount: number,
  stack: { width: number; height: number },
  orientation: PlanOrientation,
): {
  initiativeAt: (index: number) => { x: number; y: number };
  stackOrigin: { x: number; y: number };
  bounds: { width: number; height: number };
} {
  const card = PLAN_INITIATIVE_SIZE;
  if (orientation === 'column') {
    // Initiatives in a row on top, centred over the stack; the stack centred under them.
    const rowWidth = initiativeCount * card.width + Math.max(0, initiativeCount - 1) * STACK_GAP;
    const rowHeight = initiativeCount > 0 ? card.height : 0;
    const width = Math.max(rowWidth, stack.width);
    const stackTop = initiativeCount > 0 ? rowHeight + INITIATIVE_ROW_GUTTER : 0;
    return {
      initiativeAt: (index) => ({
        x: (width - rowWidth) / 2 + index * (card.width + STACK_GAP),
        y: 0,
      }),
      stackOrigin: { x: (width - stack.width) / 2, y: stackTop },
      bounds: { width, height: stackTop + stack.height },
    };
  }
  // Initiatives in a column on the left, centred against the stack's height.
  const columnHeight = initiativeCount * card.height + Math.max(0, initiativeCount - 1) * STACK_GAP;
  const height = Math.max(stack.height, columnHeight);
  const stackLeft = initiativeCount > 0 ? card.width + INITIATIVE_GUTTER : 0;
  return {
    initiativeAt: (index) => ({
      x: 0,
      y: (height - columnHeight) / 2 + index * (card.height + STACK_GAP),
    }),
    stackOrigin: { x: stackLeft, y: 0 },
    bounds: { width: stackLeft + stack.width, height },
  };
}

/**
 * Lay out a projected plan.
 *
 * @param nodes - Unpositioned nodes from `projectPlan`, parents first.
 * @param orientation - `row` beside the initiative (landscape) or `column` beneath it (portrait).
 * @returns positioned nodes and the packed extent.
 */
export function layoutPlan(
  nodes: readonly Node[],
  orientation: PlanOrientation = 'row',
): PlanLayout {
  const grouped = tasksByProject(nodes);
  const initiatives = nodes.filter((node) => node.type === PLAN_NODE_TYPE.initiative);
  const projects = nodes.filter((node) => node.type === PLAN_NODE_TYPE.project);
  const stacked = stackProjects(projects, grouped, orientation);
  const board = placeBoard(initiatives.length, stacked, orientation);
  const linkSide = orientation === 'column' ? Position.Bottom : Position.Right;

  const positioned: Node[] = [];
  initiatives.forEach((node, index) => {
    positioned.push({
      ...node,
      position: board.initiativeAt(index),
      style: { ...node.style, ...PLAN_INITIATIVE_SIZE },
      sourcePosition: linkSide,
      targetPosition: Position.Left,
    });
  });
  for (const node of projects) {
    const rect = stacked.rects.get(node.id);
    if (!rect) continue;
    positioned.push({
      ...node,
      position: { x: board.stackOrigin.x + rect.x, y: board.stackOrigin.y + rect.y },
      style: { ...node.style, width: rect.width, height: rect.height },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });
  }
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
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
    });
  }
  return { nodes: positioned, bounds: board.bounds };
}

/**
 * Point membership links at the container handle that faces the initiative in this orientation.
 *
 * @param edges - Edges from `projectPlan`.
 * @param orientation - The board's orientation.
 * @returns the same edges, with link edges landing on the header's left or top handle.
 */
export function orientPlanEdges(edges: readonly Edge[], orientation: PlanOrientation): Edge[] {
  const handle = PLAN_LINK_HANDLE[orientation];
  return edges.map((edge) =>
    edge.type === PLAN_EDGE_TYPE.link ? { ...edge, targetHandle: handle } : edge,
  );
}

/** The memo key: structure only, so a field edit never re-packs the board. */
function planStructureKey(nodes: readonly Node[]): string {
  const grouped = tasksByProject(nodes);
  return nodes
    .filter((node) => node.type !== PLAN_NODE_TYPE.task)
    .map((node) => {
      const rows = grouped.get(node.id) ?? [];
      const footer = (node.data as { canAddTask?: boolean }).canAddTask === true ? 'f' : '';
      return `${node.id}:${node.type ?? ''}:${rows.map((row) => row.id).join('+')}${footer}`;
    })
    .join('|');
}

/**
 * Lay out a plan, re-packing only when its structure or orientation changes.
 *
 * @param nodes - Unpositioned nodes from `projectPlan`.
 * @param epoch - Explicit re-layout counter from the viewport toolbar.
 * @param orientation - The board's orientation, from the host's aspect.
 * @returns positioned nodes and the packed extent.
 */
export function usePlanLayout(
  nodes: readonly Node[],
  epoch: number,
  orientation: PlanOrientation = 'row',
): PlanLayout {
  const structureKey = planStructureKey(nodes);
  // The geometry is memoised on structure and the explicit re-layout epoch; the current node
  // data is re-applied on every render so a renamed or highlighted node updates without moving.
  const latest = useRef(nodes);
  latest.current = nodes;
  const geometry = useMemo(
    () => layoutPlan(latest.current, orientation),
    [structureKey, epoch, orientation],
  );
  return useMemo(() => {
    const byId = new Map(geometry.nodes.map((node) => [node.id, node]));
    return {
      bounds: geometry.bounds,
      nodes: nodes
        .map((node) => {
          const placed = byId.get(node.id);
          return placed ? { ...placed, data: node.data } : null;
        })
        .filter((node): node is Node => node !== null),
    };
  }, [geometry, nodes]);
}
