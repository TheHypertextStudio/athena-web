/** `@docket/web` — Project graph adapter tests. */
import { renderHook } from '@testing-library/react';
import type { Node } from '@xyflow/react';
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
