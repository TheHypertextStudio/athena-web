import type { OverlapLayoutInterval, OverlapLayoutResult } from './scheduling-overlap-sweep';

type ConflictPredicate = (left: OverlapLayoutInterval, right: OverlapLayoutInterval) => boolean;

function buildNeighbors(
  intervals: readonly OverlapLayoutInterval[],
  component: readonly number[],
  conflicts: ConflictPredicate,
): Set<number>[] {
  const neighbors = Array.from({ length: component.length }, () => new Set<number>());
  for (let left = 0; left < component.length; left += 1) {
    const leftInterval = intervals[component[left] ?? -1];
    if (!leftInterval) continue;
    for (let right = left + 1; right < component.length; right += 1) {
      const rightInterval = intervals[component[right] ?? -1];
      if (!rightInterval || !conflicts(leftInterval, rightInterval)) continue;
      neighbors[left]?.add(right);
      neighbors[right]?.add(left);
    }
  }
  return neighbors;
}

function canonicalGreedyColoring(neighbors: readonly ReadonlySet<number>[]): number[] {
  const colors = new Array<number>(neighbors.length).fill(-1);
  for (let vertex = 0; vertex < neighbors.length; vertex += 1) {
    const unavailable = new Set<number>();
    for (const neighbor of neighbors[vertex] ?? []) {
      const color = colors[neighbor];
      if (color !== undefined && color >= 0) unavailable.add(color);
    }
    let color = 0;
    while (unavailable.has(color)) color += 1;
    colors[vertex] = color;
  }
  return colors;
}

function oneColoring(neighbors: readonly ReadonlySet<number>[]): number[] | null {
  return neighbors.some((adjacent) => adjacent.size > 0)
    ? null
    : new Array<number>(neighbors.length).fill(0);
}

function twoColoring(neighbors: readonly ReadonlySet<number>[]): number[] | null {
  const colors = new Array<number>(neighbors.length).fill(-1);
  for (let start = 0; start < neighbors.length; start += 1) {
    if (colors[start] !== -1) continue;
    colors[start] = 0;
    const pending = [start];
    for (const vertex of pending) {
      const color = colors[vertex] ?? 0;
      for (const neighbor of neighbors[vertex] ?? []) {
        const neighborColor = colors[neighbor];
        if (neighborColor === color) return null;
        if (neighborColor === -1) {
          colors[neighbor] = 1 - color;
          pending.push(neighbor);
        }
      }
    }
  }
  return colors;
}

function canonicalColoring(
  neighbors: readonly ReadonlySet<number>[],
  columnCount: number,
): number[] | null {
  const colors = new Array<number>(neighbors.length).fill(-1);
  const search = (vertex: number, greatestColor: number): boolean => {
    if (vertex === neighbors.length) return true;
    const unavailable = new Set<number>();
    for (const neighbor of neighbors[vertex] ?? []) {
      const color = colors[neighbor];
      if (color !== undefined && color >= 0) unavailable.add(color);
    }
    const greatestCandidate = Math.min(columnCount - 1, greatestColor + 1);
    for (let color = 0; color <= greatestCandidate; color += 1) {
      if (unavailable.has(color)) continue;
      colors[vertex] = color;
      if (search(vertex + 1, Math.max(greatestColor, color))) return true;
    }
    colors[vertex] = -1;
    return false;
  };
  return search(0, -1) ? colors : null;
}

function minimumColoring(
  neighbors: readonly ReadonlySet<number>[],
  minimumColumnCount: number,
): number[] {
  const greedy = canonicalGreedyColoring(neighbors);
  const greedyColumnCount = Math.max(0, ...greedy) + 1;
  for (
    let columnCount = Math.max(1, minimumColumnCount);
    columnCount <= greedyColumnCount;
    columnCount += 1
  ) {
    const colors =
      columnCount === 1
        ? oneColoring(neighbors)
        : columnCount === 2
          ? twoColoring(neighbors)
          : canonicalColoring(neighbors, columnCount);
    if (colors) return colors;
  }
  return greedy;
}

/**
 * Recolor only components changed by exact-instant overlap edges using the fewest columns.
 *
 * @remarks Visual interval concurrency supplies a valid chromatic lower bound. The general union
 * graph is solved from that bound upward; one- and two-column cases use linear checks, while rare
 * higher-color components use deterministic canonical backtracking.
 */
export function colorAffectedOverlapComponents(
  intervals: readonly OverlapLayoutInterval[],
  visualLayout: readonly OverlapLayoutResult[],
  components: readonly (readonly number[])[],
  conflicts: ConflictPredicate,
): OverlapLayoutResult[] {
  const results = visualLayout.map((placement) => ({ ...placement }));
  for (const component of components) {
    const firstIndex = component[0];
    const firstInterval = firstIndex === undefined ? undefined : intervals[firstIndex];
    if (!firstInterval) continue;
    const neighbors = buildNeighbors(intervals, component, conflicts);
    const visualLowerBound = Math.max(
      1,
      ...component.map((index) => visualLayout[index]?.columnCount ?? 1),
    );
    const colors = minimumColoring(neighbors, visualLowerBound);
    const columnCount = Math.max(0, ...colors) + 1;
    for (let position = 0; position < component.length; position += 1) {
      const index = component[position];
      if (index === undefined) continue;
      results[index] = {
        clusterId: firstInterval.id,
        columnIndex: colors[position] ?? 0,
        columnCount,
      };
    }
  }
  return results;
}
