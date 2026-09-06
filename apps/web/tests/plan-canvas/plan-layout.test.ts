import { describe, expect, it } from 'vitest';

import type { Edge, Node } from '@xyflow/react';

import { layoutPlan, projectContainerHeight } from '../../src/components/plan-canvas/plan-layout';
import {
  PLAN_INITIATIVE_SIZE,
  PLAN_NODE_TYPE,
  PLAN_PROJECT_HEADER,
  PLAN_PROJECT_PADDING,
  PLAN_PROJECT_WIDTH,
  PLAN_TASK_GAP,
  PLAN_TASK_SIZE,
} from '../../src/components/plan-canvas/plan-nodes';

function mustFind(nodes: readonly Node[], id: string): Node {
  const found = nodes.find((n) => n.id === id);
  if (!found) throw new Error(`Expected node ${id}`);
  return found;
}

function make(
  id: string,
  type: string,
  extra: Partial<Node> = {},
  data: Record<string, unknown> = {},
): Node {
  return { id, type, position: { x: 0, y: 0 }, data, ...extra };
}

const NODES: Node[] = [
  make('init', PLAN_NODE_TYPE.initiative),
  make('p1', PLAN_NODE_TYPE.project, {}, { canAddTask: true }),
  make('p2', PLAN_NODE_TYPE.project, {}, { canAddTask: false }),
  make('t1', PLAN_NODE_TYPE.task, { parentId: 'p1' }),
  make('t2', PLAN_NODE_TYPE.task, { parentId: 'p1' }),
  make('t3', PLAN_NODE_TYPE.task, { parentId: 'p2' }),
];

const EDGES: Edge[] = [
  { id: 'link:init>p1', source: 'init', target: 'p1', type: 'planLink' },
  { id: 'link:init>p2', source: 'init', target: 'p2', type: 'planLink' },
  { id: 'dep:t1>t3', source: 't1', target: 't3', type: 'default' },
];

describe('projectContainerHeight', () => {
  it('grows with its rows and the Add task footer', () => {
    const empty = projectContainerHeight(0, false);
    expect(empty).toBe(PLAN_PROJECT_HEADER + PLAN_PROJECT_PADDING * 2);
    expect(projectContainerHeight(2, false) - empty).toBe(
      PLAN_TASK_SIZE.height * 2 + PLAN_TASK_GAP,
    );
    expect(projectContainerHeight(2, true)).toBeGreaterThan(projectContainerHeight(2, false));
  });
});

describe('layoutPlan', () => {
  it('sizes containers to their rows and keeps every row inside its container', () => {
    const { nodes } = layoutPlan(NODES, EDGES, 16 / 9);
    const p1 = nodes.find((n) => n.id === 'p1');
    expect(p1?.style).toMatchObject({
      width: PLAN_PROJECT_WIDTH,
      height: projectContainerHeight(2, true),
    });
    const rows = nodes.filter((n) => n.parentId === 'p1');
    expect(rows.map((n) => n.id)).toEqual(['t1', 't2']);
    for (const row of rows) {
      expect(row.extent).toBe('parent');
      expect(row.position.x).toBeGreaterThanOrEqual(0);
      expect(row.position.x + PLAN_TASK_SIZE.width).toBeLessThanOrEqual(PLAN_PROJECT_WIDTH);
      expect(row.position.y).toBeGreaterThanOrEqual(PLAN_PROJECT_HEADER);
      expect(row.position.y + PLAN_TASK_SIZE.height).toBeLessThanOrEqual(
        projectContainerHeight(2, true),
      );
    }
    expect(mustFind(rows, 't2').position.y - mustFind(rows, 't1').position.y).toBe(
      PLAN_TASK_SIZE.height + PLAN_TASK_GAP,
    );
  });

  it('places the initiative left of the projects it links to, and keeps top-level nodes apart', () => {
    const { nodes } = layoutPlan(NODES, EDGES, 16 / 9);
    const init = mustFind(nodes, 'init');
    const p1 = mustFind(nodes, 'p1');
    const p2 = mustFind(nodes, 'p2');
    expect(init.position.x + PLAN_INITIATIVE_SIZE.width).toBeLessThanOrEqual(p1.position.x);
    expect(init.position.x + PLAN_INITIATIVE_SIZE.width).toBeLessThanOrEqual(p2.position.x);
    const overlapY =
      p1.position.y < p2.position.y + projectContainerHeight(1, false) &&
      p2.position.y < p1.position.y + projectContainerHeight(2, true);
    const overlapX =
      p1.position.x < p2.position.x + PLAN_PROJECT_WIDTH &&
      p2.position.x < p1.position.x + PLAN_PROJECT_WIDTH;
    expect(overlapX && overlapY).toBe(false);
  });

  it('projects a task dependency onto its containers so dependent projects follow', () => {
    const { nodes } = layoutPlan(NODES, EDGES, 16 / 9);
    const p1 = mustFind(nodes, 'p1');
    const p2 = mustFind(nodes, 'p2');
    expect(p1.position.x).toBeLessThan(p2.position.x);
  });

  it('lays out an empty plan without throwing', () => {
    const { nodes } = layoutPlan([], [], 1);
    expect(nodes).toEqual([]);
  });
});
