/** `@docket/web` — compound xyflow task hierarchy layout tests. */
import { renderHook } from '@testing-library/react';
import type { Edge, Node } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GraphLayoutOptions,
  GraphLayoutResult,
  MeasuredGraphNode,
  ProjectedGraphEdge,
} from '@/components/canvas/graph-layout-engine';

type LayoutMeasuredGraph = (
  nodes: readonly MeasuredGraphNode[],
  edges: readonly ProjectedGraphEdge[],
  options: GraphLayoutOptions,
) => GraphLayoutResult;

const { layoutMeasuredGraphSpy } = vi.hoisted(() => ({ layoutMeasuredGraphSpy: vi.fn() }));

vi.mock('@/components/canvas/graph-layout-engine', async (importOriginal) => {
  const actual = await importOriginal<{ layoutMeasuredGraph: LayoutMeasuredGraph }>();
  layoutMeasuredGraphSpy.mockImplementation(actual.layoutMeasuredGraph);
  return { ...actual, layoutMeasuredGraph: layoutMeasuredGraphSpy };
});

import {
  layoutTaskHierarchy,
  retainTaskHierarchyAncestors,
  useTaskHierarchyLayout,
} from '@/components/canvas/task-hierarchy-layout';

beforeEach(() => {
  layoutMeasuredGraphSpy.mockClear();
});

function node(id: string, parentTaskId: string | null, projectId = 'p1'): Node {
  return {
    id,
    type: 'task',
    position: { x: 0, y: 0 },
    data: { parentTaskId, projectId, title: id },
  };
}

const nodes = [
  node('root-a', null, 'p1'),
  node('child-a', 'root-a', 'p2'),
  node('grandchild-a', 'child-a', 'p2'),
  node('sibling-a', 'root-a', 'p1'),
  node('root-b', null, 'p2'),
];
const edges: Edge[] = [{ id: 'dep:grandchild-a:root-b', source: 'grandchild-a', target: 'root-b' }];

function findNode(items: Node[], id: string): Node {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Expected layout node ${id}`);
  return item;
}

describe('layoutTaskHierarchy', () => {
  it('emits parents before children with 48px relative indentation and recursive bounds', () => {
    const laidOut = layoutTaskHierarchy(nodes, edges, 'compact', 'LR');
    const byId = new Map(laidOut.map((item) => [item.id, item]));

    expect(laidOut.map(({ id }) => id)).toEqual([
      'root-a',
      'child-a',
      'grandchild-a',
      'sibling-a',
      'root-b',
    ]);
    expect(byId.get('child-a')).toMatchObject({ parentId: 'root-a', position: { x: 48 } });
    expect(byId.get('grandchild-a')).toMatchObject({ parentId: 'child-a', position: { x: 48 } });
    expect(byId.get('child-a')?.extent).toBeUndefined();
    expect(Number(byId.get('root-a')?.style?.width)).toBeGreaterThan(240);
    expect(Number(byId.get('root-a')?.style?.height)).toBeGreaterThan(56 * 3);
  });

  it('preserves sibling order and changes top-level flow for LR and TB', () => {
    const lr = layoutTaskHierarchy(nodes, edges, 'compact', 'LR');
    const tb = layoutTaskHierarchy(nodes, edges, 'compact', 'TB');
    const child = findNode(lr, 'child-a');
    const sibling = findNode(lr, 'sibling-a');
    expect(child.position.y).toBeLessThan(sibling.position.y);
    const lrA = findNode(lr, 'root-a').position;
    const lrB = findNode(lr, 'root-b').position;
    const tbA = findNode(tb, 'root-a').position;
    const tbB = findNode(tb, 'root-b').position;
    expect(lrA.x).toBeLessThan(lrB.x);
    expect(tbA.y).toBeLessThan(tbB.y);
  });

  it('projects cross-tree dependencies to compound roots while retaining actual edge endpoints', () => {
    const laidOut = layoutTaskHierarchy(nodes, edges, 'compact', 'LR');
    expect(findNode(laidOut, 'root-a').position.x).toBeLessThan(
      findNode(laidOut, 'root-b').position.x,
    );
    expect(edges[0]).toMatchObject({ source: 'grandchild-a', target: 'root-b' });
  });

  it('retains the ancestor chain needed to orient a filtered descendant', () => {
    expect(retainTaskHierarchyAncestors(nodes, ['grandchild-a']).map(({ id }) => id)).toEqual([
      'root-a',
      'child-a',
      'grandchild-a',
    ]);
  });

  it('nests lane, root, and descendant chains using the root task lane', () => {
    const laidOut = layoutTaskHierarchy(nodes, edges, 'compact', 'LR', {
      groupOf: (item) => String(item.data['projectId']),
      labelOf: (id) => id.toUpperCase(),
    });
    const byId = new Map(laidOut.map((item) => [item.id, item]));

    expect(byId.get('root-a')?.parentId).toBe('group:p1');
    expect(byId.get('child-a')?.parentId).toBe('root-a');
    expect(byId.get('grandchild-a')?.parentId).toBe('child-a');
    expect(byId.get('child-a')?.parentId).not.toBe('group:p2');
    expect(laidOut.findIndex(({ id }) => id === 'group:p1')).toBeLessThan(
      laidOut.findIndex(({ id }) => id === 'root-a'),
    );
  });

  it('packs disconnected hierarchy roots into rows instead of one Dagre rank', () => {
    const roots = Array.from({ length: 12 }, (_, index) => node(`root-${index}`, null));
    const laidOut = layoutTaskHierarchy(roots, [], 'compact', 'LR');
    const positions = laidOut.map(({ position }) => `${position.x}:${position.y}`);

    expect(new Set(laidOut.map(({ position }) => position.x)).size).toBeGreaterThan(1);
    expect(new Set(laidOut.map(({ position }) => position.y)).size).toBeGreaterThan(1);
    expect(new Set(positions).size).toBe(roots.length);
  });

  it('reuses hierarchy geometry when only Task properties change', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: Node[] }) =>
        useTaskHierarchyLayout(items, edges, 'compact', 'LR', null, 16 / 9),
      { initialProps: { items: nodes } },
    );
    const firstPositions = result.current.map(({ position }) => position);

    rerender({
      items: nodes.map((item) =>
        item.id === 'root-a'
          ? { ...item, data: { ...item.data, title: 'Renamed', status: 'completed' } }
          : item,
      ),
    });

    expect(layoutMeasuredGraphSpy).toHaveBeenCalledTimes(1);
    expect(result.current.map(({ position }) => position)).toEqual(firstPositions);
    expect(result.current.find(({ id }) => id === 'root-a')?.data).toMatchObject({
      title: 'Renamed',
    });
  });
});
