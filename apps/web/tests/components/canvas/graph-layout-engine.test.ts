/** `@docket/web` — component-aware graph layout engine tests. */
import { describe, expect, it } from 'vitest';

import {
  graphLayoutStructureKey,
  layoutMeasuredGraph,
  projectGraphEdges,
} from '@/components/canvas/graph-layout-engine';
import { deriveGraphInitialFrame } from '@/components/canvas/graph-initial-frame';

describe('layoutMeasuredGraph', () => {
  it('finds weak components after projecting nested dependency endpoints to top-level roots', () => {
    const nodes = [
      { id: 'branch-a', width: 300, height: 180 },
      { id: 'branch-b', width: 300, height: 84 },
      { id: 'branch-c', width: 300, height: 84 },
    ];
    const projected = projectGraphEdges(
      [
        { source: 'nested-a', target: 'nested-b' },
        { source: 'nested-a', target: 'nested-b' },
      ],
      new Map([
        ['nested-a', 'branch-a'],
        ['nested-b', 'branch-b'],
      ]),
    );

    expect(projected).toEqual([{ source: 'branch-a', target: 'branch-b' }]);
    expect(
      layoutMeasuredGraph(nodes, projected, { direction: 'LR', aspectRatio: 16 / 9 }).components,
    ).toEqual([
      expect.objectContaining({ nodeIds: ['branch-a', 'branch-b'] }),
      expect.objectContaining({ nodeIds: ['branch-c'] }),
    ]);
  });

  it('runs Dagre inside each component and packs component rectangles without overlaps', () => {
    const result = layoutMeasuredGraph(
      [
        { id: 'a', width: 300, height: 180 },
        { id: 'b', width: 300, height: 84 },
        { id: 'c', width: 240, height: 56 },
        { id: 'd', width: 240, height: 140 },
      ],
      [
        { source: 'a', target: 'b' },
        { source: 'c', target: 'd' },
      ],
      { direction: 'LR', aspectRatio: 16 / 9 },
    );
    const a = result.positions.get('a');
    const b = result.positions.get('b');
    const [first, second] = result.components;
    if (a === undefined || b === undefined || first === undefined || second === undefined) {
      throw new Error('Expected both positioned components.');
    }

    expect(a.x).toBeLessThan(b.x);
    expect(
      first.bounds.x + first.bounds.width <= second.bounds.x ||
        second.bounds.x + second.bounds.width <= first.bounds.x ||
        first.bounds.y + first.bounds.height <= second.bounds.y ||
        second.bounds.y + second.bounds.height <= first.bounds.y,
    ).toBe(true);
  });

  it('packs the same components into rows that follow the coarse viewport aspect', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `root-${index}`,
      width: 300,
      height: 84,
    }));
    const landscape = layoutMeasuredGraph(items, [], { direction: 'LR', aspectRatio: 16 / 9 });
    const portrait = layoutMeasuredGraph(items, [], { direction: 'LR', aspectRatio: 3 / 4 });

    expect(landscape.bounds.width).toBeGreaterThan(portrait.bounds.width);
    expect(landscape.bounds.height).toBeLessThan(portrait.bounds.height);
  });

  it('keys and positions layout from structure rather than object properties or exact aspect', () => {
    const first = [
      { id: 'a', width: 300, height: 84, label: 'Before' },
      { id: 'b', width: 300, height: 84, label: 'Stable' },
    ];
    const changed = first.map((item) =>
      item.id === 'a' ? { ...item, label: 'After', status: 'completed' } : item,
    );
    const edges = [{ source: 'a', target: 'b' }];

    expect(graphLayoutStructureKey(first, edges, 'LR', 1.5)).toBe(
      graphLayoutStructureKey(changed, edges, 'LR', 2.2),
    );
    expect([
      ...layoutMeasuredGraph(first, edges, { direction: 'LR', aspectRatio: 1.5 }).positions,
    ]).toEqual([
      ...layoutMeasuredGraph(changed, edges, { direction: 'LR', aspectRatio: 2.2 }).positions,
    ]);
  });

  it('keeps the 363-task regression readable within the pure-layout budget', () => {
    const tasks = Array.from({ length: 363 }, (_, index) => ({
      id: `task-${index}`,
      width: 240,
      height: 56,
    }));
    const dependencies = Array.from({ length: 28 }, (_, index) => ({
      source: `task-${index}`,
      target: `task-${index + 1}`,
    }));
    const result = layoutMeasuredGraph(tasks, dependencies, {
      direction: 'LR',
      aspectRatio: 16 / 9,
    });

    expect(result.components).toHaveLength(335);
    expect(new Set([...result.positions.values()].map(({ x }) => x)).size).toBeGreaterThan(1);
    expect(new Set([...result.positions.values()].map(({ y }) => y)).size).toBeGreaterThan(1);
    expect(result.primary.anchorNodeId).toBe('task-1');
    expect(result.diagnostics.durationMs).toBeLessThanOrEqual(100);
  });

  it('frames the largest top-level component and its highest-degree root', () => {
    const frame = deriveGraphInitialFrame(
      [
        { id: 'group:p1', type: 'group', position: { x: 0, y: 0 }, data: {} },
        { id: 'root-a', parentId: 'group:p1', position: { x: 0, y: 0 }, data: {} },
        { id: 'child-a', parentId: 'root-a', position: { x: 0, y: 0 }, data: {} },
        { id: 'root-b', parentId: 'group:p1', position: { x: 0, y: 0 }, data: {} },
        { id: 'root-c', position: { x: 0, y: 0 }, data: {} },
      ],
      [
        { id: 'a>b', source: 'child-a', target: 'root-b' },
        { id: 'b>c', source: 'root-b', target: 'root-c' },
      ],
    );

    expect(frame).toEqual({
      nodeIds: ['root-a', 'root-b', 'root-c'],
      anchorNodeId: 'root-b',
    });
  });
});
