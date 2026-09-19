/** `@docket/web` — animated node position tests. */
import { act, renderHook } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cubicBezierEasing,
  emphasizedDecelerate,
  useAnimatedNodePositions,
} from '@/components/canvas/use-animated-node-positions';

let queue = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

/** Run every pending animation frame callback at the given timestamp. */
function runFrame(timestamp: number): void {
  const pending = [...queue.values()];
  queue = new Map();
  act(() => {
    for (const callback of pending) callback(timestamp);
  });
}

function node(id: string, x: number, y = 0, extra: Partial<Node> = {}): Node {
  return { id, position: { x, y }, data: {}, ...extra };
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

function renderAnimator(initial: Node[]) {
  return renderHook(() => {
    const [nodes, setNodes] = useState(initial);
    const { animate, cancel } = useAnimatedNodePositions(setNodes);
    return { nodes, setNodes, animate, cancel };
  });
}

beforeEach(() => {
  queue = new Map();
  nextFrameId = 1;
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

describe('cubicBezierEasing', () => {
  it('pins the endpoints and matches a linear curve when the control points are on the diagonal', () => {
    const linear = cubicBezierEasing(0, 0, 1, 1);

    expect(emphasizedDecelerate(0)).toBe(0);
    expect(emphasizedDecelerate(1)).toBe(1);
    expect(linear(0.3)).toBeCloseTo(0.3, 4);
    expect(linear(0.75)).toBeCloseTo(0.75, 4);
  });

  it('decelerates: most of the distance is covered early and progress never decreases', () => {
    expect(emphasizedDecelerate(0.25)).toBeGreaterThan(0.5);
    let last = 0;
    for (let step = 1; step <= 20; step += 1) {
      const value = emphasizedDecelerate(step / 20);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });
});

describe('useAnimatedNodePositions', () => {
  it('moves only the nodes whose position differs, with an intermediate frame between old and new', () => {
    const from = [node('moving', 0, 0), node('still', 50, 50)];
    const to = [node('moving', 200, 100), node('still', 50, 50)];
    const { result } = renderAnimator(from);

    act(() => {
      result.current.animate(from, to);
    });
    runFrame(1000);
    runFrame(1120);

    const middle = result.current.nodes[0]?.position;
    expect(middle?.x).toBeGreaterThan(0);
    expect(middle?.x).toBeLessThan(200);
    expect(middle?.y).toBeGreaterThan(0);
    expect(middle?.y).toBeLessThan(100);
    expect(result.current.nodes[1]).toBe(to[1]);
  });

  it('sets exactly the target on the final frame and stops requesting frames', () => {
    const from = [node('a', 0, 0), node('b', 10, 10)];
    const to = [node('a', 300, 40), node('b', 10, 10, { data: { name: 'updated' } })];
    const { result } = renderAnimator(from);

    act(() => {
      result.current.animate(from, to);
    });
    runFrame(0);
    runFrame(100);
    runFrame(240);

    expect(result.current.nodes).toEqual(to);
    expect(queue.size).toBe(0);
  });

  it('applies non-position changes on the first frame so data never waits for the tween', () => {
    const from = [node('a', 0, 0)];
    const to = [node('a', 300, 0, { data: { name: 'fresh' } })];
    const { result } = renderAnimator(from);

    act(() => {
      result.current.animate(from, to);
    });

    expect(result.current.nodes[0]?.data).toEqual({ name: 'fresh' });
    expect(result.current.nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('jumps straight to the target under reduced motion', () => {
    stubReducedMotion(true);
    const from = [node('a', 0, 0)];
    const to = [node('a', 300, 40)];
    const { result } = renderAnimator(from);

    act(() => {
      result.current.animate(from, to);
    });

    expect(result.current.nodes).toEqual(to);
    expect(queue.size).toBe(0);
  });

  it('sets the target at once when no position changed', () => {
    const from = [node('a', 5, 5)];
    const to = [node('a', 5, 5, { data: { name: 'renamed' } })];
    const { result } = renderAnimator(from);

    act(() => {
      result.current.animate(from, to);
    });

    expect(result.current.nodes).toEqual(to);
    expect(queue.size).toBe(0);
  });

  it('retargets from the interpolated position when a new sync arrives mid-flight', () => {
    const start = [node('a', 0, 0)];
    const { result } = renderAnimator(start);
    act(() => {
      result.current.animate(start, [node('a', 200, 0)]);
    });
    runFrame(0);
    runFrame(80);
    const interrupted = result.current.nodes[0]?.position.x ?? 0;
    expect(interrupted).toBeGreaterThan(0);
    expect(interrupted).toBeLessThan(200);

    act(() => {
      result.current.animate(result.current.nodes, [node('a', -100, 0)]);
    });
    runFrame(1000);
    expect(result.current.nodes[0]?.position.x).toBeCloseTo(interrupted, 6);
    runFrame(1100);
    const afterRetarget = result.current.nodes[0]?.position.x ?? 0;
    expect(afterRetarget).toBeLessThan(interrupted);
    expect(afterRetarget).toBeGreaterThan(-100);
    runFrame(1240);

    expect(result.current.nodes[0]?.position).toEqual({ x: -100, y: 0 });
    expect(queue.size).toBe(0);
  });

  it('leaves a node the pointer is dragging where the drag put it', () => {
    const from = [node('dragged', 0, 0, { dragging: true }), node('free', 0, 0)];
    const to = [node('dragged', 200, 0), node('free', 200, 0)];
    const { result } = renderAnimator(from);

    act(() => {
      result.current.animate(from, to);
    });
    runFrame(0);
    runFrame(120);
    runFrame(240);

    expect(result.current.nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(result.current.nodes[0]?.dragging).toBe(true);
    expect(result.current.nodes[1]?.position).toEqual({ x: 200, y: 0 });
  });

  it('stops moving a node once the pointer grabs it mid-flight', () => {
    const from = [node('a', 0, 0)];
    const to = [node('a', 200, 0)];
    const { result } = renderAnimator(from);
    act(() => {
      result.current.animate(from, to);
    });
    runFrame(0);
    runFrame(60);
    act(() => {
      result.current.setNodes((live) =>
        live.map((entry) => ({ ...entry, position: { x: 42, y: 7 }, dragging: true })),
      );
    });

    runFrame(120);
    runFrame(240);

    expect(result.current.nodes[0]?.position).toEqual({ x: 42, y: 7 });
  });

  it('keeps a selection the viewer made while the tween ran', () => {
    const from = [node('a', 0, 0)];
    const to = [node('a', 200, 0)];
    const { result } = renderAnimator(from);
    act(() => {
      result.current.animate(from, to);
    });
    runFrame(0);
    act(() => {
      result.current.setNodes((live) => live.map((entry) => ({ ...entry, selected: true })));
    });

    runFrame(120);
    runFrame(240);

    expect(result.current.nodes[0]).toMatchObject({ position: { x: 200, y: 0 }, selected: true });
  });

  it('does not re-apply the start positions on the frame that records the start time', () => {
    const from = [node('a', 0, 0)];
    const { result } = renderAnimator(from);
    act(() => {
      result.current.animate(from, [node('a', 200, 0)]);
    });
    const settled = result.current.nodes;

    runFrame(1000);

    expect(result.current.nodes).toBe(settled);
    expect(queue.size).toBe(1);
  });

  it('stops a tween once cancelled, leaving the nodes where it last placed them', () => {
    const from = [node('a', 0, 0)];
    const { result } = renderAnimator(from);
    act(() => {
      result.current.animate(from, [node('a', 200, 0)]);
    });
    runFrame(0);
    runFrame(80);
    const placed = result.current.nodes;

    act(() => {
      result.current.cancel();
    });
    runFrame(1000);

    expect(queue.size).toBe(0);
    expect(result.current.nodes).toBe(placed);
  });

  it('cancels the pending frame on unmount', () => {
    const from = [node('a', 0, 0)];
    const { result, unmount } = renderAnimator(from);
    act(() => {
      result.current.animate(from, [node('a', 200, 0)]);
    });
    expect(queue.size).toBe(1);

    unmount();

    expect(queue.size).toBe(0);
  });
});
