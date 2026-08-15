/** `@docket/web` — compound xyflow task hierarchy layout tests. */
import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  layoutTaskHierarchy,
  retainTaskHierarchyAncestors,
} from '@/components/canvas/task-hierarchy-layout';

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
    const child = lr.find(({ id }) => id === 'child-a')!;
    const sibling = lr.find(({ id }) => id === 'sibling-a')!;
    expect(child.position.y).toBeLessThan(sibling.position.y);
    const lrA = lr.find(({ id }) => id === 'root-a')!.position;
    const lrB = lr.find(({ id }) => id === 'root-b')!.position;
    const tbA = tb.find(({ id }) => id === 'root-a')!.position;
    const tbB = tb.find(({ id }) => id === 'root-b')!.position;
    expect(lrA.x).toBeLessThan(lrB.x);
    expect(tbA.y).toBeLessThan(tbB.y);
  });

  it('projects cross-tree dependencies to compound roots while retaining actual edge endpoints', () => {
    const laidOut = layoutTaskHierarchy(nodes, edges, 'compact', 'LR');
    expect(laidOut.find(({ id }) => id === 'root-a')!.position.x).toBeLessThan(
      laidOut.find(({ id }) => id === 'root-b')!.position.x,
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
});
