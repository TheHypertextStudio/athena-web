/** `@docket/web` — Dagre layout hook tests. */
import { renderHook } from '@testing-library/react';
import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { useDagreLayout } from '@/components/canvas/use-dagre-layout';

function node(id: string): Node {
  return { id, position: { x: 7, y: 9 }, data: {} };
}

const NODES = [node('a'), node('b')];
const EDGES: Edge[] = [{ id: 'a>b', source: 'a', target: 'b' }];

describe('useDagreLayout', () => {
  it('ranks connected nodes apart and orients their handles along the flow', () => {
    const { result } = renderHook(() => useDagreLayout(NODES, EDGES, 'full'));

    const [first, second] = result.current;
    expect(first?.position.x).toBeLessThan(second?.position.x ?? 0);
    expect(first?.sourcePosition).toBe('right');
    expect(second?.targetPosition).toBe('left');
  });

  it('hands back the nodes it was given when the host positions them itself', () => {
    const { result } = renderHook(() => useDagreLayout(NODES, EDGES, 'full', 'LR', false));

    expect(result.current).toBe(NODES);
  });
});
