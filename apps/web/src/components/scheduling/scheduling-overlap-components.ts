import type { OverlapLayoutInterval, OverlapLayoutResult } from './scheduling-overlap-sweep';

interface ExactInterval {
  readonly clusterIndex: number;
  readonly columnIndex: number;
  readonly endMinutes: number;
  readonly index: number;
  readonly startMinutes: number;
}

/** Compact union-find over visual clusters connected by exact-instant overlap components. */
class DisjointClusters {
  private readonly parents: number[];

  public constructor(size: number) {
    this.parents = Array.from({ length: size }, (_, index) => index);
  }

  public find(index: number): number {
    const parent = this.parents[index];
    if (parent === undefined || parent === index) return index;
    const root = this.find(parent);
    this.parents[index] = root;
    return root;
  }

  public union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parents[rightRoot] = leftRoot;
  }
}

function collectExactIntervals(
  intervals: readonly OverlapLayoutInterval[],
  placements: readonly OverlapLayoutResult[],
  clusterIndexById: ReadonlyMap<string, number>,
): ExactInterval[] {
  const exact: ExactInterval[] = [];
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    const placement = placements[index];
    if (!interval || !placement) continue;
    const startMinutes = interval.exactStartMinutes;
    const endMinutes = interval.exactEndMinutes;
    const clusterIndex = clusterIndexById.get(placement.clusterId);
    if (
      clusterIndex === undefined ||
      startMinutes === undefined ||
      endMinutes === undefined ||
      !Number.isFinite(startMinutes) ||
      !Number.isFinite(endMinutes) ||
      startMinutes >= endMinutes
    ) {
      continue;
    }
    exact.push({
      clusterIndex,
      columnIndex: placement.columnIndex,
      endMinutes,
      index,
      startMinutes,
    });
  }
  return exact.sort(
    (left, right) =>
      left.startMinutes - right.startMinutes ||
      right.endMinutes - left.endMinutes ||
      left.index - right.index,
  );
}

function connectExactComponent(
  clusterIndexes: ReadonlySet<number>,
  clusters: DisjointClusters,
  affectedClusters: Set<number>,
): void {
  if (clusterIndexes.size < 2) return;
  const [first, ...rest] = clusterIndexes;
  if (first === undefined) return;
  affectedClusters.add(first);
  for (const clusterIndex of rest) {
    clusters.union(first, clusterIndex);
    affectedClusters.add(clusterIndex);
  }
}

/**
 * Find only union-graph components whose exact-instant edges alter the visual sweep.
 *
 * @remarks Exact components can join otherwise independent visual clusters. An exact edge inside
 * one visual cluster matters only when it conflicts with a column the visual sweep reused. The
 * returned index groups include every item from affected visual clusters, while unrelated lane
 * items remain on the linearithmic sweep path.
 */
export function findAffectedOverlapComponents(
  intervals: readonly OverlapLayoutInterval[],
  placements: readonly OverlapLayoutResult[],
): readonly (readonly number[])[] {
  const clusterIds: string[] = [];
  const clusterIndexById = new Map<string, number>();
  const itemIndexesByCluster: number[][] = [];
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    if (!placement) continue;
    let clusterIndex = clusterIndexById.get(placement.clusterId);
    if (clusterIndex === undefined) {
      clusterIndex = clusterIds.length;
      clusterIds.push(placement.clusterId);
      clusterIndexById.set(placement.clusterId, clusterIndex);
      itemIndexesByCluster.push([]);
    }
    itemIndexesByCluster[clusterIndex]?.push(index);
  }

  const clusters = new DisjointClusters(clusterIds.length);
  const affectedClusters = new Set<number>();
  const exact = collectExactIntervals(intervals, placements, clusterIndexById);
  const latestEndByClusterAndColumn = new Map<number, Map<number, number>>();
  let exactComponentEnd = Number.NEGATIVE_INFINITY;
  let exactComponentClusters = new Set<number>();

  for (const interval of exact) {
    if (interval.startMinutes >= exactComponentEnd) {
      connectExactComponent(exactComponentClusters, clusters, affectedClusters);
      exactComponentClusters = new Set<number>();
      exactComponentEnd = interval.endMinutes;
    } else {
      exactComponentEnd = Math.max(exactComponentEnd, interval.endMinutes);
    }
    exactComponentClusters.add(interval.clusterIndex);

    const latestEndByColumn =
      latestEndByClusterAndColumn.get(interval.clusterIndex) ?? new Map<number, number>();
    const latestEnd = latestEndByColumn.get(interval.columnIndex);
    if (latestEnd !== undefined && interval.startMinutes < latestEnd) {
      affectedClusters.add(interval.clusterIndex);
    }
    latestEndByColumn.set(
      interval.columnIndex,
      Math.max(latestEnd ?? interval.endMinutes, interval.endMinutes),
    );
    latestEndByClusterAndColumn.set(interval.clusterIndex, latestEndByColumn);
  }
  connectExactComponent(exactComponentClusters, clusters, affectedClusters);

  const affectedRoots = new Set(
    [...affectedClusters].map((clusterIndex) => clusters.find(clusterIndex)),
  );
  const componentsByRoot = new Map<number, number[]>();
  for (let clusterIndex = 0; clusterIndex < itemIndexesByCluster.length; clusterIndex += 1) {
    const root = clusters.find(clusterIndex);
    if (!affectedRoots.has(root)) continue;
    const component = componentsByRoot.get(root) ?? [];
    component.push(...(itemIndexesByCluster[clusterIndex] ?? []));
    componentsByRoot.set(root, component);
  }
  return [...componentsByRoot.values()]
    .map((component) => component.sort((left, right) => left - right))
    .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
}
