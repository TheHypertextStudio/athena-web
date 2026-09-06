import { describe, expect, it } from 'vitest';

import type { Edge, Node } from '@xyflow/react';

import {
  PLAN_LINK_HANDLE,
  layoutPlan,
  orientPlanEdges,
  projectContainerHeight,
} from '../../src/components/plan-canvas/plan-layout';
import {
  PLAN_EDGE_TYPE,
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

function rect(node: Node): { x: number; y: number; width: number; height: number } {
  return {
    x: node.position.x,
    y: node.position.y,
    width: Number(node.style?.width ?? 0),
    height: Number(node.style?.height ?? 0),
  };
}

function overlaps(a: Node, b: Node): boolean {
  const ra = rect(a);
  const rb = rect(b);
  return (
    ra.x < rb.x + rb.width &&
    rb.x < ra.x + ra.width &&
    ra.y < rb.y + rb.height &&
    rb.y < ra.y + ra.height
  );
}

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
    const { nodes } = layoutPlan(NODES);
    const p1 = mustFind(nodes, 'p1');
    expect(p1.style).toMatchObject({
      width: PLAN_PROJECT_WIDTH,
      height: projectContainerHeight(2, true),
    });
    const rows = nodes.filter((n) => n.parentId === 'p1');
    expect(rows.map((n) => n.id)).toEqual(['t1', 't2']);
    for (const row of rows) {
      expect(row.parentId).toBe('p1');
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

  it('stands the initiative left of a stacked column of containers in document order', () => {
    const { nodes, bounds } = layoutPlan(NODES);
    const init = mustFind(nodes, 'init');
    const p1 = mustFind(nodes, 'p1');
    const p2 = mustFind(nodes, 'p2');
    expect(init.position.x + PLAN_INITIATIVE_SIZE.width).toBeLessThan(p1.position.x);
    expect(p1.position.x).toBe(p2.position.x);
    expect(p1.position.y).toBeLessThan(p2.position.y);
    expect(overlaps(p1, p2)).toBe(false);
    expect(overlaps(init, p1)).toBe(false);
    // The initiative sits at the vertical centre of the stack.
    const stackMid = (p2.position.y + Number(p2.style?.height ?? 0)) / 2;
    const initMid = init.position.y + PLAN_INITIATIVE_SIZE.height / 2;
    expect(Math.abs(stackMid - initMid)).toBeLessThan(1);
    expect(bounds.width).toBe(p1.position.x + PLAN_PROJECT_WIDTH);
    expect(bounds.height).toBe(p2.position.y + Number(p2.style?.height ?? 0));
  });

  it('opens a second column once a column would hold more than four containers', () => {
    const many: Node[] = [
      make('init', PLAN_NODE_TYPE.initiative),
      ...Array.from({ length: 6 }, (_, index) =>
        make(`p${String(index)}`, PLAN_NODE_TYPE.project, {}, { canAddTask: false }),
      ),
    ];
    const { nodes } = layoutPlan(many);
    const xs = new Set(
      nodes.filter((n) => n.type === PLAN_NODE_TYPE.project).map((n) => n.position.x),
    );
    expect(xs.size).toBe(2);
    const columns = [...xs].sort((a, b) => a - b);
    const first = nodes.filter((n) => n.position.x === columns[0]).length;
    const second = nodes.filter((n) => n.position.x === columns[1]).length;
    expect(first).toBe(3);
    expect(second).toBe(3);
  });

  it('points dependency handles down the stack and membership handles across it', () => {
    const { nodes } = layoutPlan(NODES);
    expect(mustFind(nodes, 'init').sourcePosition).toBe('right');
    expect(mustFind(nodes, 'p1').sourcePosition).toBe('bottom');
    expect(mustFind(nodes, 'p1').targetPosition).toBe('top');
    expect(mustFind(nodes, 't1').sourcePosition).toBe('bottom');
  });

  it('lays out an empty plan without throwing', () => {
    const { nodes, bounds } = layoutPlan([]);
    expect(nodes).toEqual([]);
    expect(bounds).toEqual({ width: 0, height: 0 });
  });
});

describe('layoutPlan in a portrait host', () => {
  it('runs the containers down one column beneath a centred initiative', () => {
    const { nodes, bounds } = layoutPlan(NODES, 'column');
    const init = mustFind(nodes, 'init');
    const p1 = mustFind(nodes, 'p1');
    const p2 = mustFind(nodes, 'p2');
    expect(init.sourcePosition).toBe('bottom');
    expect(init.position.y + PLAN_INITIATIVE_SIZE.height).toBeLessThan(p1.position.y);
    expect(p1.position.x).toBe(p2.position.x);
    expect(p1.position.y).toBeLessThan(p2.position.y);
    expect(overlaps(init, p1)).toBe(false);
    expect(overlaps(p1, p2)).toBe(false);
    // Centred over the stack, so the whole board is only as wide as a container.
    const initMid = init.position.x + PLAN_INITIATIVE_SIZE.width / 2;
    expect(Math.abs(initMid - (p1.position.x + PLAN_PROJECT_WIDTH / 2))).toBeLessThan(1);
    expect(bounds.width).toBe(PLAN_PROJECT_WIDTH);
  });

  it('keeps six containers in a single column', () => {
    const many: Node[] = [
      make('init', PLAN_NODE_TYPE.initiative),
      ...Array.from({ length: 6 }, (_, index) =>
        make(`p${String(index)}`, PLAN_NODE_TYPE.project, {}, { canAddTask: false }),
      ),
    ];
    const { nodes } = layoutPlan(many, 'column');
    const xs = new Set(
      nodes.filter((n) => n.type === PLAN_NODE_TYPE.project).map((n) => n.position.x),
    );
    expect(xs.size).toBe(1);
  });
});

describe('orientPlanEdges', () => {
  const edges: Edge[] = [
    { id: 'l', source: 'init', target: 'p1', type: PLAN_EDGE_TYPE.link, targetHandle: 'link' },
    {
      id: 'd',
      source: 'p1',
      target: 'p2',
      type: PLAN_EDGE_TYPE.dependency,
      sourceHandle: 'dep-out',
      targetHandle: 'dep-in',
    },
  ];

  it('lands membership links on the header top in a portrait board and leaves dependencies alone', () => {
    const oriented = orientPlanEdges(edges, 'column');
    expect(oriented[0]?.targetHandle).toBe(PLAN_LINK_HANDLE.column);
    expect(oriented[1]).toEqual(edges[1]);
    expect(orientPlanEdges(edges, 'row')[0]?.targetHandle).toBe(PLAN_LINK_HANDLE.row);
  });
});
