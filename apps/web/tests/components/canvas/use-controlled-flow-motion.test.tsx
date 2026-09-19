/** `@docket/web` — how controlled xyflow state applies a rearrangement versus a structural change. */
import { act, renderHook } from '@testing-library/react';
import type { Edge, Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { startViewTransitionSpy } = vi.hoisted(() => ({ startViewTransitionSpy: vi.fn() }));

vi.mock('@/lib/view-transition', () => ({
  startViewTransition: startViewTransitionSpy,
}));

import { useControlledFlow } from '@/components/canvas/use-controlled-flow';

let queue = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

function runFrame(timestamp: number): void {
  const pending = [...queue.values()];
  queue = new Map();
  act(() => {
    for (const callback of pending) callback(timestamp);
  });
}

function node(id: string, x: number): Node {
  return { id, position: { x, y: 20 }, data: { name: id } };
}

function edge(id: string): Edge {
  return { id, source: 'a', target: 'b' };
}

function stubReducedMotion(reduced: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

interface FlowProps {
  readonly nodes: Node[];
  readonly edges: Edge[];
  readonly animate?: boolean;
}

function renderFlow(initial: FlowProps) {
  return renderHook(
    ({ nodes, edges, animate }: FlowProps) =>
      useControlledFlow(nodes, edges, animate === undefined ? {} : { animate }),
    { initialProps: initial },
  );
}

beforeEach(() => {
  queue = new Map();
  nextFrameId = 1;
  startViewTransitionSpy.mockReset();
  startViewTransitionSpy.mockImplementation((update: () => void) => {
    update();
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    queue.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue.delete(id);
  });
  stubReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useControlledFlow motion', () => {
  it('tweens a rearrangement of the same nodes without a View Transition', () => {
    const { result, rerender } = renderFlow({ nodes: [node('a', 0), node('b', 100)], edges: [] });

    rerender({ nodes: [node('a', 200), node('b', 100)], edges: [] });
    runFrame(0);
    runFrame(120);

    const middle = result.current.nodes[0]?.position.x ?? 0;
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(200);
    expect(result.current.layoutApplied).toBe(false);

    runFrame(240);

    expect(result.current.nodes[0]?.position).toEqual({ x: 200, y: 20 });
    expect(result.current.layoutApplied).toBe(true);
    expect(startViewTransitionSpy).not.toHaveBeenCalled();
  });

  it('applies the new edges immediately while positions are still moving', () => {
    const { result, rerender } = renderFlow({
      nodes: [node('a', 0), node('b', 100)],
      edges: [],
    });

    rerender({ nodes: [node('a', 200), node('b', 100)], edges: [edge('a->b')] });

    expect(result.current.edges.map(({ id }) => id)).toEqual(['a->b']);
    expect(result.current.nodes[0]?.position.x).toBe(0);
    expect(queue.size).toBe(1);
  });

  it('jumps to the new positions under reduced motion', () => {
    stubReducedMotion(true);
    const { result, rerender } = renderFlow({ nodes: [node('a', 0)], edges: [] });

    rerender({ nodes: [node('a', 200)], edges: [] });

    expect(result.current.nodes[0]?.position).toEqual({ x: 200, y: 20 });
    expect(queue.size).toBe(0);
    expect(startViewTransitionSpy).not.toHaveBeenCalled();
  });

  it('applies positions at once while animation is disabled, such as before the first frame', () => {
    const { result, rerender } = renderFlow({
      nodes: [node('a', 0)],
      edges: [],
      animate: false,
    });

    rerender({ nodes: [node('a', 200)], edges: [], animate: false });

    expect(result.current.nodes[0]?.position).toEqual({ x: 200, y: 20 });
    expect(queue.size).toBe(0);
  });

  it('keeps a selected node selected through the tween', () => {
    const { result, rerender } = renderFlow({ nodes: [node('a', 0)], edges: [] });
    act(() => {
      result.current.onNodesChange([{ type: 'select', id: 'a', selected: true }]);
    });

    rerender({ nodes: [node('a', 200)], edges: [] });
    runFrame(0);
    runFrame(100);
    runFrame(240);

    expect(result.current.nodes[0]).toMatchObject({ position: { x: 200, y: 20 }, selected: true });
  });

  it('runs a named-scope View Transition when nodes are added', () => {
    const { result, rerender } = renderFlow({ nodes: [node('a', 0)], edges: [] });

    rerender({ nodes: [node('a', 0), node('b', 300)], edges: [] });

    expect(startViewTransitionSpy).toHaveBeenCalledTimes(1);
    expect(startViewTransitionSpy).toHaveBeenCalledWith(expect.any(Function), { scope: 'named' });
    expect(result.current.nodes.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(queue.size).toBe(0);
  });

  it('stops a tween in flight when the node set changes so it cannot drop the new nodes', () => {
    const { result, rerender } = renderFlow({ nodes: [node('a', 0)], edges: [] });
    rerender({ nodes: [node('a', 200)], edges: [] });
    runFrame(0);
    runFrame(100);
    expect(queue.size).toBe(1);

    rerender({ nodes: [node('a', 200), node('b', 300)], edges: [] });
    runFrame(240);
    runFrame(480);

    expect(queue.size).toBe(0);
    expect(result.current.nodes.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(result.current.layoutApplied).toBe(true);
  });

  it('runs a named-scope View Transition when nodes are removed', () => {
    const { result, rerender } = renderFlow({
      nodes: [node('a', 0), node('b', 300)],
      edges: [],
    });

    rerender({ nodes: [node('a', 0)], edges: [] });

    expect(startViewTransitionSpy).toHaveBeenCalledWith(expect.any(Function), { scope: 'named' });
    expect(result.current.nodes.map(({ id }) => id)).toEqual(['a']);
  });

  it('does nothing when the incoming graph is unchanged', () => {
    const { rerender } = renderFlow({ nodes: [node('a', 0)], edges: [] });

    rerender({ nodes: [node('a', 0)], edges: [] });

    expect(startViewTransitionSpy).not.toHaveBeenCalled();
    expect(queue.size).toBe(0);
  });
});
