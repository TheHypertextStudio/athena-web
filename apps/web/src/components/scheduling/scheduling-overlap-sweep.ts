/** Canonically ordered interval consumed by the overlap layout strategies. */
export interface OverlapLayoutInterval {
  readonly id: string;
  readonly startMinutes: number;
  readonly effectiveEndMinutes: number;
  readonly exactStartMinutes?: number;
  readonly exactEndMinutes?: number;
}

/** Column and cluster metadata aligned with one input interval. */
export interface OverlapLayoutResult {
  readonly columnIndex: number;
  readonly columnCount: number;
  readonly clusterId: string;
}

interface ActiveColumn {
  readonly columnIndex: number;
  readonly endMinutes: number;
}

/** Minimal binary heap used by the interval sweep without adding a scheduling dependency. */
class MinHeap<T> {
  private readonly values: T[] = [];

  public constructor(private readonly compare: (left: T, right: T) => number) {}

  public get size(): number {
    return this.values.length;
  }

  public clear(): void {
    this.values.length = 0;
  }

  public peek(): T | undefined {
    return this.values[0];
  }

  public push(value: T): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.values[parentIndex];
      if (parent === undefined || this.compare(parent, value) <= 0) break;
      this.values[index] = parent;
      index = parentIndex;
    }
    this.values[index] = value;
  }

  public pop(): T | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (first === undefined || last === undefined || this.values.length === 0) return first;

    let index = 0;
    let leftIndex = index * 2 + 1;
    while (leftIndex < this.values.length) {
      const rightIndex = leftIndex + 1;
      const left = this.values[leftIndex];
      const right = this.values[rightIndex];
      if (left === undefined) break;
      const childIndex =
        right !== undefined && this.compare(right, left) < 0 ? rightIndex : leftIndex;
      const child = this.values[childIndex];
      if (child === undefined || this.compare(last, child) <= 0) break;
      this.values[index] = child;
      index = childIndex;
      leftIndex = index * 2 + 1;
    }
    this.values[index] = last;
    return first;
  }
}

function finalizeCluster(
  results: (OverlapLayoutResult | undefined)[],
  startIndex: number,
  endIndex: number,
  columnCount: number,
): void {
  for (let index = startIndex; index < endIndex; index += 1) {
    const result = results[index];
    if (result) results[index] = { ...result, columnCount };
  }
}

/**
 * Assign visual interval columns with a stable lowest-free-column sweep.
 *
 * @param intervals - Intervals already ordered by the scheduling canonical comparator.
 * @returns Placement metadata aligned with the input order.
 */
export function layoutVisualOverlapSweep(
  intervals: readonly OverlapLayoutInterval[],
): OverlapLayoutResult[] {
  if (intervals.length === 0) return [];
  const activeColumns = new MinHeap<ActiveColumn>(
    (left, right) => left.endMinutes - right.endMinutes || left.columnIndex - right.columnIndex,
  );
  const reusableColumns = new MinHeap<number>((left, right) => left - right);
  const results = new Array<OverlapLayoutResult | undefined>(intervals.length);
  let clusterStartIndex = 0;
  let clusterId = intervals[0]?.id ?? 'cluster-0';
  let nextColumnIndex = 0;

  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    if (!interval) continue;
    while (
      activeColumns.peek() !== undefined &&
      (activeColumns.peek()?.endMinutes ?? Number.POSITIVE_INFINITY) <= interval.startMinutes
    ) {
      const released = activeColumns.pop();
      if (released) reusableColumns.push(released.columnIndex);
    }

    if (activeColumns.size === 0 && index > clusterStartIndex) {
      finalizeCluster(results, clusterStartIndex, index, nextColumnIndex);
      clusterStartIndex = index;
      clusterId = interval.id;
      nextColumnIndex = 0;
      reusableColumns.clear();
    }

    const reusableColumn = reusableColumns.pop();
    const columnIndex = reusableColumn ?? nextColumnIndex;
    if (reusableColumn === undefined) nextColumnIndex += 1;
    results[index] = { clusterId, columnIndex, columnCount: 1 };
    activeColumns.push({ columnIndex, endMinutes: interval.effectiveEndMinutes });
  }

  finalizeCluster(results, clusterStartIndex, intervals.length, nextColumnIndex);
  return results.flatMap((result) => (result ? [result] : []));
}
