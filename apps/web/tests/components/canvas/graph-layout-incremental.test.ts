/** `@docket/web` — incremental component layout tests. */
import { renderHook } from '@testing-library/react';
import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  type GraphLayoutComponent,
  type GraphLayoutOptions,
  type GraphLayoutResult,
  layoutMeasuredGraph,
  type MeasuredGraphNode,
  type ProjectedGraphEdge,
} from '@/components/canvas/graph-layout-engine';
import { layoutMeasuredGraphIncrementally } from '@/components/canvas/graph-layout-incremental';
import { useProjectGraphLayout } from '@/components/canvas/project-graph-layout';
import { PROJECT_NODE_SIZE } from '@/components/canvas/project-node';

const OPTIONS: GraphLayoutOptions = { direction: 'LR', aspectRatio: 16 / 9 };

function measured(ids: readonly string[]): MeasuredGraphNode[] {
  return ids.map((id) => ({ id, width: 300, height: 84 }));
}

function edge(source: string, target: string): ProjectedGraphEdge {
  return { source, target };
}

function componentOf(result: GraphLayoutResult, id: string): GraphLayoutComponent {
  const found = result.components.find(({ nodeIds }) => nodeIds.includes(id));
  if (found === undefined) throw new Error(`No component holds ${id}`);
  return found;
}

function positionsOf(result: GraphLayoutResult, ids: readonly string[]) {
  return ids.map((id) => [id, result.positions.get(id)]);
}

function overlaps(left: GraphLayoutComponent, right: GraphLayoutComponent): boolean {
  const a = left.bounds;
  const b = right.bounds;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const ISOLATED = ['i0', 'i1', 'i2', 'i3', 'i4', 'i5'];

describe('layoutMeasuredGraphIncrementally', () => {
  const ids = [...ISOLATED, 'a1', 'a2', 'b1', 'b2'];
  const nodes = measured(ids);
  const edges = [edge('a1', 'a2'), edge('b1', 'b2')];
  const previous = layoutMeasuredGraph(nodes, edges, OPTIONS);

  it('leaves every other component in place when an edge joins two components', () => {
    const joined = layoutMeasuredGraphIncrementally(
      nodes,
      [...edges, edge('a2', 'b1')],
      OPTIONS,
      previous,
    );

    expect(positionsOf(joined, ISOLATED)).toEqual(positionsOf(previous, ISOLATED));
    expect(joined.components).toHaveLength(previous.components.length - 1);
    expect(componentOf(joined, 'b2')).toBe(componentOf(joined, 'a1'));
    for (const [index, left] of joined.components.entries()) {
      for (const right of joined.components.slice(index + 1)) {
        expect(overlaps(left, right)).toBe(false);
      }
    }
  });

  it('reuses the geometry of every component the edit did not touch', () => {
    const joined = layoutMeasuredGraphIncrementally(
      nodes,
      [...edges, edge('a2', 'b1')],
      OPTIONS,
      previous,
    );

    expect(componentOf(joined, 'i3').localPositions).toBe(
      componentOf(previous, 'i3').localPositions,
    );
  });

  it('moves only the components packed after a changed one, and only by its size delta', () => {
    const leading = measured(['a1', 'a2', ...ISOLATED]);
    const before = layoutMeasuredGraph(leading, [edge('a1', 'a2')], OPTIONS);
    const grown = layoutMeasuredGraphIncrementally(
      measured(['a1', 'a2', 'a3', ...ISOLATED]),
      [edge('a1', 'a2'), edge('a2', 'a3')],
      OPTIONS,
      before,
    );

    expect(componentOf(grown, 'a1').bounds).toMatchObject({
      x: componentOf(before, 'a1').bounds.x,
      y: componentOf(before, 'a1').bounds.y,
    });
    expect(componentOf(grown, 'a1').bounds.width).toBeGreaterThan(
      componentOf(before, 'a1').bounds.width,
    );
    expect(grown.packing.perRow).toBe(before.packing.perRow);
    expect(grown.packing.order).toEqual(before.packing.order);
    for (const [index, left] of grown.components.entries()) {
      for (const right of grown.components.slice(index + 1)) {
        expect(overlaps(left, right)).toBe(false);
      }
    }
  });

  it('keeps a component at its origin when a removed edge does not split it', () => {
    const triangle = measured(['t1', 't2', 't3', 'solo']);
    const triangleEdges = [edge('t1', 't2'), edge('t2', 't3'), edge('t1', 't3')];
    const before = layoutMeasuredGraph(triangle, triangleEdges, OPTIONS);

    const after = layoutMeasuredGraphIncrementally(
      triangle,
      [edge('t1', 't2'), edge('t2', 't3')],
      OPTIONS,
      before,
    );

    const origin = componentOf(before, 't1').bounds;
    expect(componentOf(after, 't1').bounds).toMatchObject({ x: origin.x, y: origin.y });
    expect(componentOf(after, 't1').nodeIds).toEqual(['t1', 't2', 't3']);
    expect(componentOf(after, 't1').edgeSignature).not.toBe(
      componentOf(before, 't1').edgeSignature,
    );
  });

  it('keeps the anchor piece in place when a component splits and slots the new piece after it', () => {
    const chain = measured(['c1', 'c2', 'c3', ...ISOLATED]);
    const before = layoutMeasuredGraph(chain, [edge('c1', 'c2'), edge('c2', 'c3')], OPTIONS);

    const after = layoutMeasuredGraphIncrementally(chain, [edge('c1', 'c2')], OPTIONS, before);

    const origin = componentOf(before, 'c1').bounds;
    expect(componentOf(after, 'c1').nodeIds).toEqual(['c1', 'c2']);
    expect(componentOf(after, 'c1').bounds).toMatchObject({ x: origin.x, y: origin.y });
    const order = after.packing.order;
    expect(order.indexOf('c3')).toBe(order.indexOf('c1') + 1);
    expect(order.slice(0, order.indexOf('c1'))).toEqual(
      before.packing.order.slice(0, before.packing.order.indexOf('c1')),
    );
  });

  it('keeps the anchor alone in place when it is the piece that separates', () => {
    const chain = measured(['c1', 'c2', 'c3', ...ISOLATED]);
    const before = layoutMeasuredGraph(chain, [edge('c1', 'c2'), edge('c2', 'c3')], OPTIONS);

    const after = layoutMeasuredGraphIncrementally(chain, [edge('c2', 'c3')], OPTIONS, before);

    expect(componentOf(after, 'c1').nodeIds).toEqual(['c1']);
    expect(componentOf(after, 'c1').bounds).toMatchObject({
      x: componentOf(before, 'c1').bounds.x,
      y: componentOf(before, 'c1').bounds.y,
    });
    expect(after.packing.order.indexOf('c2')).toBe(after.packing.order.indexOf('c1') + 1);
  });

  it('appends a brand new component after every existing one', () => {
    const after = layoutMeasuredGraphIncrementally(
      measured([...ids, 'fresh']),
      edges,
      OPTIONS,
      previous,
    );

    expect(after.packing.order.at(-1)).toBe('fresh');
    expect(positionsOf(after, ids)).toEqual(positionsOf(previous, ids));
  });

  it('holds the previous row count and slot order even when the aspect ratio differs', () => {
    const portrait: GraphLayoutOptions = { direction: 'LR', aspectRatio: 3 / 4 };
    const incremental = layoutMeasuredGraphIncrementally(
      nodes,
      [...edges, edge('a2', 'b1')],
      portrait,
      previous,
    );
    const full = layoutMeasuredGraph(nodes, [...edges, edge('a2', 'b1')], portrait);

    expect(incremental.packing.perRow).toBe(previous.packing.perRow);
    expect(full.packing.perRow).not.toBe(previous.packing.perRow);
  });

  it('carries the largest component and its best-connected member as the primary anchor', () => {
    const after = layoutMeasuredGraphIncrementally(
      nodes,
      [...edges, edge('a2', 'b1')],
      OPTIONS,
      previous,
    );

    expect(after.primary.nodeIds).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(['a2', 'b1']).toContain(after.primary.anchorNodeId);
    expect(after.diagnostics.componentCount).toBe(after.components.length);
  });

  it('lays out an empty graph without a previous packing to hold', () => {
    const empty = layoutMeasuredGraph([], [], OPTIONS);

    const after = layoutMeasuredGraphIncrementally(measured(['x', 'y']), [], OPTIONS, empty);

    expect(after.components).toHaveLength(2);
    expect(after.packing.perRow).toBe(1);
  });
});

describe('useProjectGraphLayout re-layout', () => {
  function flowNodes(count: number): Node[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      position: { x: 0, y: 0 },
      data: {},
    }));
  }

  it('repacks every component when the re-layout epoch is bumped', () => {
    const projects = flowNodes(10);
    const first: Edge[] = [{ id: 'p0-p1', source: 'p0', target: 'p1' }];
    const edited: Edge[] = [...first, { id: 'p1-p2', source: 'p1', target: 'p2' }];
    const { result, rerender } = renderHook(
      ({ edges, epoch }: { edges: Edge[]; epoch: number }) =>
        useProjectGraphLayout(projects, edges, 3 / 4, epoch),
      { initialProps: { edges: first, epoch: 0 } },
    );
    const initialPerRow = result.current.layout.packing.perRow;

    rerender({ edges: edited, epoch: 0 });
    expect(result.current.layout.packing.perRow).toBe(initialPerRow);

    rerender({ edges: edited, epoch: 1 });
    const fresh = layoutMeasuredGraph(
      projects.map(({ id }) => ({ id, ...PROJECT_NODE_SIZE.full })),
      [edge('p0', 'p1'), edge('p1', 'p2')],
      { direction: 'LR', aspectRatio: 3 / 4 },
    );
    expect(result.current.layout.packing).toEqual(fresh.packing);
    expect(result.current.layout.components.map(({ bounds }) => bounds)).toEqual(
      fresh.components.map(({ bounds }) => bounds),
    );
  });
});
