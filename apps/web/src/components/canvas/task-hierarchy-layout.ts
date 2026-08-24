'use client';

/** Compound xyflow layout for indented task hierarchy trees and independent dependencies. */
import { type Edge, type Node, Position } from '@xyflow/react';
import { useMemo } from 'react';

import { createTaskHierarchy } from '@/components/tasks/task-hierarchy-model';

import {
  coarseGraphAspectRatio,
  layoutMeasuredGraph,
  projectGraphEdges,
} from './graph-layout-engine';
import type { GroupSpec } from './use-grouped-layout';
import { type CanvasDensity, type LayoutDirection, NODE_SIZE } from './use-dagre-layout';

/** Horizontal indentation between a parent task header and each child branch. */
export const TASK_HIERARCHY_INDENT = 48;
const BRANCH_GAP = 16;
const SIBLING_GAP = 10;
const LANE_PADDING = 20;
const LANE_HEADER = 30;
const LANE_GAP = 40;

interface MeasuredBranch {
  readonly width: number;
  readonly height: number;
  readonly childPositions: ReadonlyMap<string, { x: number; y: number }>;
}

/** Read the hierarchy parent carried in task-node data. */
function parentOf(node: Node): string | null {
  const value = node.data['parentTaskId'];
  return typeof value === 'string' ? value : null;
}

/** Retain hierarchy ancestors required to orient a filtered set of task matches. */
export function retainTaskHierarchyAncestors(
  nodes: readonly Node[],
  matchingIds: readonly string[],
): Node[] {
  const hierarchy = createTaskHierarchy(
    nodes.map((node) => ({ id: node.id, parentTaskId: parentOf(node) })),
  );
  const retained = new Set(hierarchy.retainAncestors(matchingIds));
  return nodes.filter(({ id }) => retained.has(id));
}

/** Measure nested branch bounds bottom-up. */
function measureBranches(
  nodes: readonly Node[],
  density: CanvasDensity,
): ReadonlyMap<string, MeasuredBranch> {
  const hierarchy = createTaskHierarchy(
    nodes.map((node) => ({ id: node.id, parentTaskId: parentOf(node) })),
  );
  const { width: cardWidth, height: cardHeight } = NODE_SIZE[density];
  const measured = new Map<string, MeasuredBranch>();
  const measure = (id: string): MeasuredBranch => {
    const existing = measured.get(id);
    if (existing) return existing;
    const children = hierarchy.childrenOf(id);
    let y = cardHeight + (children.length > 0 ? BRANCH_GAP : 0);
    let childWidth = 0;
    const childPositions = new Map<string, { x: number; y: number }>();
    for (const [index, child] of children.entries()) {
      const branch = measure(child.id);
      childPositions.set(child.id, { x: TASK_HIERARCHY_INDENT, y });
      childWidth = Math.max(childWidth, branch.width);
      y += branch.height + (index < children.length - 1 ? SIBLING_GAP : 0);
    }
    const branch: MeasuredBranch = {
      width: Math.max(cardWidth, children.length > 0 ? TASK_HIERARCHY_INDENT + childWidth : 0),
      height: children.length > 0 ? y : cardHeight,
      childPositions,
    };
    measured.set(id, branch);
    return branch;
  };
  for (const root of hierarchy.roots) measure(root.id);
  return measured;
}

/** Find the top-level hierarchy root containing a task. */
function rootIds(nodes: readonly Node[]): ReadonlyMap<string, string> {
  const parents = new Map(nodes.map((node) => [node.id, parentOf(node)]));
  const roots = new Map<string, string>();
  for (const node of nodes) {
    const seen = new Set<string>();
    let current = node.id;
    while (parents.get(current) !== null && parents.has(parents.get(current) ?? '')) {
      if (seen.has(current)) break;
      seen.add(current);
      current = parents.get(current) ?? current;
    }
    roots.set(node.id, current);
  }
  return roots;
}

/** Lay out compound roots with dependency endpoints projected to their hierarchy roots. */
function layoutRoots(
  roots: readonly Node[],
  edges: readonly Edge[],
  measured: ReadonlyMap<string, MeasuredBranch>,
  taskRoots: ReadonlyMap<string, string>,
  direction: LayoutDirection,
  aspectRatio: number,
): ReadonlyMap<string, { x: number; y: number }> {
  const rootIds = new Set(roots.map(({ id }) => id));
  const projected = projectGraphEdges(edges, taskRoots).filter(
    (edge) => rootIds.has(edge.source) && rootIds.has(edge.target),
  );
  return layoutMeasuredGraph(
    roots.map((root) => {
      const size = measured.get(root.id) ?? NODE_SIZE.full;
      return { id: root.id, width: size.width, height: size.height };
    }),
    projected,
    { direction, aspectRatio },
  ).positions;
}

/**
 * Lay out task cards as transparent compound branches while dependencies remain ordinary edges.
 *
 * @param nodes - Unpositioned task nodes carrying `data.parentTaskId`.
 * @param edges - Dependency edges, retained with their actual nested endpoints.
 * @param density - Task-card dimensions.
 * @param direction - Top-level dependency flow direction.
 * @param groupSpec - Optional lane grouping; every hierarchy follows its root task's lane.
 * @param aspectRatio - Coarse viewport aspect used to pack independent components.
 * @param layoutEpoch - Explicit re-layout request counter.
 * @returns lane containers followed by parent-before-child compound task nodes.
 */
export function layoutTaskHierarchy(
  nodes: readonly Node[],
  edges: readonly Edge[],
  density: CanvasDensity,
  direction: LayoutDirection,
  groupSpec?: GroupSpec | null,
  aspectRatio = 16 / 9,
): Node[] {
  const hierarchyRows = nodes.map((node) => ({ id: node.id, parentTaskId: parentOf(node) }));
  const hierarchy = createTaskHierarchy(hierarchyRows);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const measured = measureBranches(nodes, density);
  const taskRoots = rootIds(nodes);
  const sourcePosition = direction === 'TB' ? Position.Bottom : Position.Right;
  const targetPosition = direction === 'TB' ? Position.Top : Position.Left;
  const groupNodes: Node[] = [];
  const rootPositions = new Map<string, { x: number; y: number }>();
  const rootParents = new Map<string, string>();

  if (groupSpec) {
    const groups = new Map<string, Node[]>();
    for (const rootRef of hierarchy.roots) {
      const root = byId.get(rootRef.id);
      if (!root) continue;
      const groupId = groupSpec.groupOf(root) ?? '__ungrouped__';
      const members = groups.get(groupId) ?? [];
      members.push(root);
      groups.set(groupId, members);
    }
    let laneOffset = 0;
    for (const [groupId, roots] of groups) {
      const local = layoutRoots(roots, edges, measured, taskRoots, direction, aspectRatio);
      let maxX = 0;
      let maxY = 0;
      for (const root of roots) {
        const position = local.get(root.id) ?? { x: 0, y: 0 };
        const size = measured.get(root.id) ?? NODE_SIZE[density];
        rootPositions.set(root.id, {
          x: position.x + LANE_PADDING,
          y: position.y + LANE_PADDING + LANE_HEADER,
        });
        rootParents.set(root.id, `group:${groupId}`);
        maxX = Math.max(maxX, position.x + size.width);
        maxY = Math.max(maxY, position.y + size.height);
      }
      const width = maxX + LANE_PADDING * 2;
      const height = maxY + LANE_PADDING * 2 + LANE_HEADER;
      groupNodes.push({
        id: `group:${groupId}`,
        type: 'group',
        position: direction === 'LR' ? { x: 0, y: laneOffset } : { x: laneOffset, y: 0 },
        data: { label: groupId === '__ungrouped__' ? 'Ungrouped' : groupSpec.labelOf(groupId) },
        style: { width, height },
        selectable: false,
        draggable: false,
        zIndex: -1,
      });
      laneOffset += (direction === 'LR' ? height : width) + LANE_GAP;
    }
  } else {
    for (const [id, position] of layoutRoots(
      hierarchy.roots.map(({ id }) => byId.get(id)).filter((node): node is Node => Boolean(node)),
      edges,
      measured,
      taskRoots,
      direction,
      aspectRatio,
    )) {
      rootPositions.set(id, position);
    }
  }

  const taskNodes: Node[] = [];
  for (const ref of hierarchy.preorder) {
    const node = byId.get(ref.id);
    if (!node) continue;
    const parentId = parentOf(node);
    const size = measured.get(node.id) ?? {
      ...NODE_SIZE[density],
      childPositions: new Map<string, { x: number; y: number }>(),
    };
    const children = hierarchy.childrenOf(node.id);
    const parentPosition = parentId
      ? measured.get(parentId)?.childPositions.get(node.id)
      : rootPositions.get(node.id);
    const rootParentId = rootParents.get(node.id);
    taskNodes.push({
      ...node,
      type: 'taskBranch',
      position: parentPosition ?? { x: 0, y: 0 },
      ...(parentId ? { parentId } : rootParentId !== undefined ? { parentId: rootParentId } : {}),
      dragHandle: '.task-branch-header',
      sourcePosition,
      targetPosition,
      style: { ...node.style, width: size.width, height: size.height },
      data: {
        ...node.data,
        hierarchyDepth: hierarchy.depthOf(node.id),
        hierarchyChildYs: children.map((child) => {
          const position = size.childPositions.get(child.id) ?? { y: 0 };
          return position.y + NODE_SIZE[density].height / 2;
        }),
      },
    });
  }
  return [...groupNodes, ...taskNodes];
}

/** Build the memo key for hierarchy geometry while ignoring application-owned Task properties. */
export function taskHierarchyStructureKey(
  nodes: readonly Node[],
  edges: readonly Edge[],
  density: CanvasDensity,
  direction: LayoutDirection,
  groupSpec: GroupSpec | null | undefined,
  aspectRatio: number,
): string {
  const measured = measureBranches(nodes, density);
  return `${density}|${direction}|${String(coarseGraphAspectRatio(aspectRatio))}|${nodes
    .map((node) => {
      const size = measured.get(node.id) ?? NODE_SIZE[density];
      const group = groupSpec?.groupOf(node) ?? '';
      return `${node.id}:${parentOf(node) ?? ''}:${group}:${size.width}x${size.height}`;
    })
    .join(',')}|${edges.map((edge) => `${edge.source}>${edge.target}`).join(',')}`;
}

/** Apply cached hierarchy geometry to the latest Task and group presentation data. */
function applyTaskHierarchyGeometry(
  geometry: readonly Node[],
  nodes: readonly Node[],
  groupSpec: GroupSpec | null | undefined,
): Node[] {
  const currentById = new Map(nodes.map((node) => [node.id, node]));
  return geometry.map((positioned) => {
    if (positioned.type === 'group') {
      const groupId = positioned.id.slice('group:'.length);
      return {
        ...positioned,
        data: {
          ...positioned.data,
          label:
            groupId === '__ungrouped__' ? 'Ungrouped' : (groupSpec?.labelOf(groupId) ?? groupId),
        },
      };
    }
    const current = currentById.get(positioned.id);
    if (current === undefined) return positioned;
    return {
      ...current,
      ...positioned,
      data: {
        ...current.data,
        hierarchyDepth: positioned.data['hierarchyDepth'],
        hierarchyChildYs: positioned.data['hierarchyChildYs'],
      },
    };
  });
}

/**
 * Memoize Task hierarchy geometry from structural inputs and apply current Task properties.
 *
 * @param nodes - Task nodes carrying hierarchy and optional grouping data.
 * @param edges - Task dependency edges.
 * @param density - Task-card dimensions.
 * @param direction - Top-level dependency flow direction.
 * @param groupSpec - Optional active lane grouping.
 * @param aspectRatio - Coarse viewport aspect used to pack independent components.
 * @returns lane containers followed by current parent-before-child compound Task nodes.
 */
export function useTaskHierarchyLayout(
  nodes: readonly Node[],
  edges: readonly Edge[],
  density: CanvasDensity,
  direction: LayoutDirection,
  groupSpec: GroupSpec | null | undefined,
  aspectRatio: number,
  layoutEpoch = 0,
): Node[] {
  const structureKey = taskHierarchyStructureKey(
    nodes,
    edges,
    density,
    direction,
    groupSpec,
    aspectRatio,
  );
  const geometry = useMemo(
    () => layoutTaskHierarchy(nodes, edges, density, direction, groupSpec, aspectRatio),
    [structureKey, layoutEpoch],
  );
  return useMemo(
    () => applyTaskHierarchyGeometry(geometry, nodes, groupSpec),
    [geometry, nodes, groupSpec],
  );
}
