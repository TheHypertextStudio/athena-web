/** `@docket/web` — controlled xyflow synchronization tests. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { Position, type Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { useControlledFlow } from '@/components/canvas/use-controlled-flow';

function node(x: number): Node {
  return { id: 'project-1', position: { x, y: 20 }, data: { name: 'Stable' } };
}

describe('useControlledFlow', () => {
  it('applies layout-only position changes when object data stays unchanged', async () => {
    const { result, rerender } = renderHook(
      ({ nodes }: { nodes: Node[] }) => useControlledFlow(nodes, []),
      { initialProps: { nodes: [node(10)] } },
    );

    act(() => {
      rerender({ nodes: [node(240)] });
    });

    await waitFor(() => {
      expect(result.current.nodes[0]?.position).toEqual({ x: 240, y: 20 });
    });
  });

  it('applies handle direction changes when disconnected nodes stay in place', async () => {
    const leftToRight: Node = {
      ...node(10),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      type: 'project',
    };
    const topToBottom: Node = {
      ...node(10),
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      type: 'project',
    };
    const { result, rerender } = renderHook(
      ({ nodes }: { nodes: Node[] }) => useControlledFlow(nodes, []),
      { initialProps: { nodes: [leftToRight] } },
    );

    act(() => {
      rerender({ nodes: [topToBottom] });
    });

    await waitFor(() => {
      expect(result.current.nodes[0]).toMatchObject({
        position: { x: 10, y: 20 },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
    });
  });

  it('preserves selected nodes when refreshed object data re-syncs the graph', async () => {
    const initial = node(10);
    const { result, rerender } = renderHook(
      ({ nodes }: { nodes: Node[] }) => useControlledFlow(nodes, []),
      { initialProps: { nodes: [initial] } },
    );
    act(() => {
      result.current.onNodesChange([{ type: 'select', id: initial.id, selected: true }]);
    });
    expect(result.current.nodes[0]?.selected).toBe(true);

    act(() => {
      rerender({ nodes: [{ ...initial, data: { name: 'Updated' } }] });
    });

    await waitFor(() => {
      expect(result.current.nodes[0]).toMatchObject({
        data: { name: 'Updated' },
        selected: true,
      });
    });
  });
});
