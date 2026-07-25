/**
 * Unit tests for dependency constraint evaluation in
 * {@link import('../../../src/components/timeline/cascade')}.
 *
 * @remarks
 * The cascade is where Docket's dependency stance lives, so its semantics are pinned here rather
 * than in a render: a drag mutates only the dragged row, the ripple is *computed and offered*, the
 * proposed shift is the smallest one that clears the constraint, already-satisfied dependents are
 * left alone, and a cyclic graph degrades to a partial proposal instead of hanging.
 */
import { describe, expect, it } from 'vitest';

import {
  type CascadeGraph,
  type CascadeNode,
  computeCascade,
  findViolations,
} from '@/components/timeline/cascade';

const DAY = 86_400_000;
/** Build a graph from `[id, startDay, endDay, blocks]` tuples, in whole days from the epoch. */
function graphOf(entries: readonly [string, number, number, readonly string[]][]): CascadeGraph {
  const map = new Map<string, CascadeNode>();
  for (const [id, start, end, blocks] of entries) {
    map.set(id, { span: { start: start * DAY, end: end * DAY }, blocks });
  }
  return map;
}

describe('findViolations', () => {
  it('reports an edge whose blocker finishes after the blocked row starts', () => {
    const graph = graphOf([
      ['a', 0, 10, ['b']],
      ['b', 5, 15, []],
    ]);
    expect(findViolations(graph)).toEqual([{ blockerId: 'a', blockedId: 'b' }]);
  });

  it('reports nothing when the blocker finishes first', () => {
    const graph = graphOf([
      ['a', 0, 5, ['b']],
      ['b', 5, 15, []],
    ]);
    expect(findViolations(graph)).toEqual([]);
  });

  it('surfaces pre-existing violations without anything being dragged', () => {
    const graph = graphOf([
      ['a', 0, 30, ['b']],
      ['b', 1, 5, []],
      ['c', 0, 1, []],
    ]);
    expect(findViolations(graph)).toHaveLength(1);
  });

  it('ignores edges pointing at rows outside the graph', () => {
    const graph = graphOf([['a', 0, 10, ['missing']]]);
    expect(findViolations(graph)).toEqual([]);
  });
});

describe('computeCascade', () => {
  it('proposes the smallest shift that clears the constraint, preserving duration', () => {
    const graph = graphOf([
      ['a', 0, 5, ['b']],
      ['b', 5, 15, []],
    ]);
    // Move `a` three days later so it now ends at day 8, three days into `b`.
    const changes = computeCascade('a', { start: 3 * DAY, end: 8 * DAY }, graph);
    expect(changes).toEqual([
      { id: 'b', from: { start: 5 * DAY, end: 15 * DAY }, to: { start: 8 * DAY, end: 18 * DAY } },
    ]);
    const [shifted] = changes;
    if (!shifted) throw new Error('expected one proposed change');
    // Duration preserved exactly.
    expect(shifted.to.end - shifted.to.start).toBe(10 * DAY);
  });

  it('never proposes pulling a dependent earlier', () => {
    const graph = graphOf([
      ['a', 0, 10, ['b']],
      ['b', 30, 40, []],
    ]);
    // Moving `a` earlier relieves pressure; `b` is already satisfied and must not move.
    expect(computeCascade('a', { start: 0, end: 2 * DAY }, graph)).toEqual([]);
  });

  it('excludes the dragged row from its own proposal', () => {
    const graph = graphOf([
      ['a', 0, 5, ['b']],
      ['b', 5, 10, []],
    ]);
    const changes = computeCascade('a', { start: 3 * DAY, end: 8 * DAY }, graph);
    expect(changes.map((change) => change.id)).not.toContain('a');
  });

  it('ripples transitively through the chain', () => {
    const graph = graphOf([
      ['a', 0, 5, ['b']],
      ['b', 5, 10, ['c']],
      ['c', 10, 15, []],
    ]);
    const changes = computeCascade('a', { start: 5 * DAY, end: 10 * DAY }, graph);
    expect(changes.map((change) => change.id)).toEqual(['b', 'c']);
    const tail = changes[1];
    if (!tail) throw new Error('expected the ripple to reach the third row');
    expect(tail.to).toEqual({ start: 15 * DAY, end: 20 * DAY });
  });

  it('stops walking at a dependent that is already satisfied', () => {
    const graph = graphOf([
      ['a', 0, 5, ['b']],
      // `b` starts far in the future, so the move never reaches it — and `c` is never considered.
      ['b', 100, 110, ['c']],
      ['c', 110, 120, []],
    ]);
    expect(computeCascade('a', { start: 1 * DAY, end: 6 * DAY }, graph)).toEqual([]);
  });

  it('reports each affected row once when the graph diamonds', () => {
    const graph = graphOf([
      ['a', 0, 5, ['b', 'c']],
      ['b', 5, 10, ['d']],
      ['c', 5, 10, ['d']],
      ['d', 10, 15, []],
    ]);
    const changes = computeCascade('a', { start: 5 * DAY, end: 10 * DAY }, graph);
    const ids = changes.map((change) => change.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['b', 'c', 'd']);
  });

  it('terminates on a cycle rather than hanging', () => {
    const graph = graphOf([
      ['a', 0, 5, ['b']],
      ['b', 5, 10, ['a']],
    ]);
    expect(() => computeCascade('a', { start: 5 * DAY, end: 10 * DAY }, graph)).not.toThrow();
  });
});
