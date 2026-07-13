import type { PositionedScheduleItem, ScheduleOverlapPlacement } from './scheduling-overlap-layout';

const OUTER_GUTTER_PIXELS = 8;
const MINIMUM_READABLE_ITEM_WIDTH = 72;

/** One width-constrained collision cluster represented by a direct `+N` disclosure. */
export interface DenseScheduleOverflowGroup {
  readonly clusterId: string;
  readonly items: readonly PositionedScheduleItem[];
  readonly top: number;
  readonly height: number;
  readonly placement: ScheduleOverlapPlacement;
}

/** Timed items split into directly manipulable cards and accessible overflow disclosures. */
export interface DenseScheduleArrangement {
  readonly directItems: readonly PositionedScheduleItem[];
  readonly overflowGroups: readonly DenseScheduleOverflowGroup[];
}

/** Optional user choice that replaces one default visible collision column. */
export interface DenseScheduleArrangementOptions {
  readonly promotedItemId?: string;
}

/** Derive the number of collision columns that remain readable at the measured lane width. */
function readableColumnCount(laneWidth: number): number {
  const usableWidth = Math.max(0, laneWidth - OUTER_GUTTER_PIXELS);
  return Math.max(2, Math.floor(usableWidth / MINIMUM_READABLE_ITEM_WIDTH));
}

/** Group hidden items by a fixed local cue window without transitive time-chain expansion. */
function localOverflowBuckets(
  items: readonly PositionedScheduleItem[],
): readonly (readonly PositionedScheduleItem[])[] {
  const sorted = [...items].sort(
    (left, right) => left.top - right.top || left.item.id.localeCompare(right.item.id),
  );
  const buckets: PositionedScheduleItem[][] = [];
  for (const item of sorted) {
    const current = buckets.at(-1);
    const first = current?.[0];
    const cueEnd = first ? first.top + Math.min(64, first.height) : Number.NEGATIVE_INFINITY;
    if (current && item.top < cueEnd) {
      current.push(item);
    } else {
      buckets.push([item]);
    }
  }
  return buckets;
}

/**
 * Keep dense collision layouts readable without hiding any underlying schedule item.
 *
 * @remarks
 * Capacity follows measured lane geometry rather than a named calendar view. One column is reserved
 * for an overflow disclosure only when the cluster would otherwise make every card narrower than
 * the minimum readable width. The returned overflow groups retain each hidden item for a consumer
 * to expose through an accessible popover.
 */
export function arrangeDenseScheduleItems(
  positionedItems: readonly PositionedScheduleItem[],
  laneWidth: number,
  options: DenseScheduleArrangementOptions = {},
): DenseScheduleArrangement {
  const capacity = readableColumnCount(laneWidth);
  const clusters = new Map<string, PositionedScheduleItem[]>();
  for (const positioned of positionedItems) {
    const cluster = clusters.get(positioned.clusterId) ?? [];
    cluster.push(positioned);
    clusters.set(positioned.clusterId, cluster);
  }

  const directItems: PositionedScheduleItem[] = [];
  const overflowGroups: DenseScheduleOverflowGroup[] = [];
  for (const [clusterId, cluster] of clusters) {
    const requiredColumns = Math.max(1, ...cluster.map(({ placement }) => placement.columnCount));
    if (requiredColumns <= capacity) {
      directItems.push(...cluster);
      continue;
    }

    const directColumnCount = capacity - 1;
    const promotedColumn = cluster.find(
      ({ item: candidate }) => candidate.id === options.promotedItemId,
    )?.placement.columnIndex;
    const sourceColumns = Array.from({ length: directColumnCount }, (_, index) => index);
    if (promotedColumn !== undefined && promotedColumn >= directColumnCount) {
      sourceColumns[directColumnCount - 1] = promotedColumn;
    }
    const displayedColumns = new Map(
      sourceColumns.map((sourceColumn, displayedColumn) => [sourceColumn, displayedColumn]),
    );
    const direct = cluster.filter(({ placement }) => displayedColumns.has(placement.columnIndex));
    const overflow = cluster.filter(
      ({ placement }) => !displayedColumns.has(placement.columnIndex),
    );
    directItems.push(
      ...direct.map((positioned) => ({
        ...positioned,
        placement: {
          ...positioned.placement,
          columnIndex: displayedColumns.get(positioned.placement.columnIndex) ?? 0,
          columnCount: capacity,
        },
      })),
    );

    for (const [bucketIndex, items] of localOverflowBuckets(overflow).entries()) {
      const first = items[0];
      if (!first) continue;
      const overflowId = `${clusterId}:overflow:${String(bucketIndex)}`;
      overflowGroups.push({
        clusterId: overflowId,
        items,
        top: first.top,
        height: Math.min(64, first.height),
        placement: {
          id: overflowId,
          columnIndex: directColumnCount,
          columnCount: capacity,
        },
      });
    }
  }

  return { directItems, overflowGroups };
}
