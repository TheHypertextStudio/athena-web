/** `@docket/web` — Project graph adapter tests. */
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
  layoutProjectGraph,
  useProjectGraphLayout,
} from '@/components/canvas/project-graph-layout';
import { PROJECT_NODE_SIZE } from '@/components/canvas/project-node';

beforeEach(() => {
  layoutMeasuredGraphSpy.mockClear();
});

describe('layoutProjectGraph', () => {
  it('packs the 36-project release fixture into a readable non-overlapping grid', () => {
    const nodes: Node[] = Array.from({ length: 36 }, (_, index) => ({
      id: `project-${index.toString().padStart(2, '0')}`,
      position: { x: 0, y: 0 },
      data: { name: `Project ${index + 1}` },
    }));
    const edges: Edge[] = Array.from({ length: 11 }, (_, index) => ({
      id: `dependency-${index}`,
      source: nodes[index * 2]?.id ?? '',
      target: nodes[index * 2 + 1]?.id ?? '',
    }));
    const result = layoutProjectGraph(nodes, edges, 16 / 9);
    const rectangles = result.nodes.map((node) => ({
      x: node.position.x,
      y: node.position.y,
      width: Number(node.style?.width),
      height: Number(node.style?.height),
    }));

    expect(result.layout.diagnostics).toMatchObject({ nodeCount: 36, componentCount: 25 });
    expect(new Set(rectangles.map(({ x }) => x)).size).toBeGreaterThan(1);
    expect(new Set(rectangles.map(({ y }) => y)).size).toBeGreaterThan(1);
    for (const [index, left] of rectangles.entries()) {
      for (const right of rectangles.slice(index + 1)) {
        expect(
          left.x + left.width <= right.x ||
            right.x + right.width <= left.x ||
            left.y + left.height <= right.y ||
            right.y + right.height <= left.y,
        ).toBe(true);
      }
    }
  });

  it('measures Project cards at full density and packs disconnected projects into rows', () => {
    const nodes: Node[] = Array.from({ length: 12 }, (_, index) => ({
      id: `project-${index}`,
      position: { x: 0, y: 0 },
      data: { name: `Project ${index}` },
    }));
    const result = layoutProjectGraph(nodes, [], 16 / 9);

    expect(new Set(result.nodes.map(({ position }) => position.x)).size).toBeGreaterThan(1);
    expect(new Set(result.nodes.map(({ position }) => position.y)).size).toBeGreaterThan(1);
    expect(result.layout.components).toHaveLength(nodes.length);
    expect(result.layout.components[0]?.bounds).toMatchObject(PROJECT_NODE_SIZE.full);
    expect(result.nodes[0]?.style).toMatchObject(PROJECT_NODE_SIZE.full);
  });

  it('reuses geometry when only Project properties change', () => {
    const first: Node[] = [
      { id: 'project-1', position: { x: 0, y: 0 }, data: { name: 'Before' } },
      { id: 'project-2', position: { x: 0, y: 0 }, data: { name: 'Stable' } },
    ];
    const { result, rerender } = renderHook(
      ({ nodes }: { nodes: Node[] }) => useProjectGraphLayout(nodes, [], 16 / 9),
      { initialProps: { nodes: first } },
    );
    const firstPositions = result.current.nodes.map(({ position }) => position);

    rerender({
      nodes: first.map((node) =>
        node.id === 'project-1' ? { ...node, data: { name: 'After', health: 'on_track' } } : node,
      ),
    });

    expect(layoutMeasuredGraphSpy).toHaveBeenCalledTimes(1);
    expect(result.current.nodes.map(({ position }) => position)).toEqual(firstPositions);
    expect(result.current.nodes[0]?.data).toMatchObject({ name: 'After' });
  });
});
