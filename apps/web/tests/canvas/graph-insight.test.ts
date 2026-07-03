/**
 * Unit tests for the dependency critical-path + bottleneck analysis.
 *
 * @remarks
 * Pure logic worth its own gate: the critical path is the longest weighted chain (estimate, or
 * hop count when estimates are absent), and the bottleneck score is a node's transitive downstream
 * reach. Only `dependency` edges participate; a stray cycle must degrade to empty, never loop.
 */
import { describe, expect, it } from 'vitest';

import {
  computeInsights,
  type InsightEdge,
  type InsightNode,
} from '@/components/canvas/graph-insight';

/** Build node/edge fixtures from terse tuples. */
function graph(
  nodes: readonly [id: string, estimate: number | null][],
  deps: readonly [source: string, target: string][],
  subtasks: readonly [source: string, target: string][] = [],
): { nodes: InsightNode[]; edges: InsightEdge[] } {
  const edges: InsightEdge[] = [
    ...deps.map(([source, target]) => ({
      id: `dep:${source}:${target}`,
      kind: 'dependency' as const,
      source,
      target,
    })),
    ...subtasks.map(([source, target]) => ({
      id: `sub:${source}:${target}`,
      kind: 'subtask' as const,
      source,
      target,
    })),
  ];
  return { nodes: nodes.map(([id, estimate]) => ({ id, estimate })), edges };
}

describe('computeInsights — critical path', () => {
  it('picks the longest chain by hop count when estimates are absent', () => {
    // a→b→c (3) vs a→d (2). Critical = a,b,c.
    const { nodes, edges } = graph(
      [
        ['a', null],
        ['b', null],
        ['c', null],
        ['d', null],
      ],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['a', 'd'],
      ],
    );
    const { criticalNodeIds, criticalEdgeIds } = computeInsights(nodes, edges);
    expect([...criticalNodeIds].sort()).toEqual(['a', 'b', 'c']);
    expect(criticalEdgeIds.has('dep:a:b')).toBe(true);
    expect(criticalEdgeIds.has('dep:b:c')).toBe(true);
    expect(criticalEdgeIds.has('dep:a:d')).toBe(false);
  });

  it('weights by estimate when present (a heavy short branch beats a light long one)', () => {
    // a→b→c each estimate 1 (total 3) vs a→d estimate 10 (total 11). Critical = a,d.
    const { nodes, edges } = graph(
      [
        ['a', 1],
        ['b', 1],
        ['c', 1],
        ['d', 10],
      ],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['a', 'd'],
      ],
    );
    const { criticalNodeIds } = computeInsights(nodes, edges);
    expect([...criticalNodeIds].sort()).toEqual(['a', 'd']);
  });

  it('returns no critical path for a graph with no dependency chain', () => {
    const { nodes, edges } = graph([['a', null]], [], [['a', 'b']]);
    const { criticalNodeIds, criticalEdgeIds } = computeInsights(nodes, edges);
    expect(criticalNodeIds.size).toBe(0);
    expect(criticalEdgeIds.size).toBe(0);
  });
});

describe('computeInsights — bottleneck', () => {
  it('counts each node’s transitive downstream reach', () => {
    // a→b, a→c, c→d. a reaches {b,c,d}=3, c reaches {d}=1, b/d reach 0.
    const { nodes, edges } = graph(
      [
        ['a', null],
        ['b', null],
        ['c', null],
        ['d', null],
      ],
      [
        ['a', 'b'],
        ['a', 'c'],
        ['c', 'd'],
      ],
    );
    const { bottleneck } = computeInsights(nodes, edges);
    expect(bottleneck.get('a')).toBe(3);
    expect(bottleneck.get('c')).toBe(1);
    expect(bottleneck.get('b')).toBe(0);
    expect(bottleneck.get('d')).toBe(0);
  });

  it('ignores subtask edges', () => {
    const { nodes, edges } = graph(
      [
        ['a', null],
        ['b', null],
      ],
      [],
      [['a', 'b']],
    );
    const { bottleneck } = computeInsights(nodes, edges);
    expect(bottleneck.get('a')).toBe(0);
  });
});
