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
  readonly promotedItemId?: string | undefined;
  /** Leading width reserved by consumer context, keyed by overlap cluster. */
  readonly leadingInsetByCluster?: ReadonlyMap<string, number> | undefined;
  /** Smallest useful card or disclosure column on this surface. */
  readonly minimumReadableItemWidth?: number | undefined;
  /** Fixed disclosure width when the consumer favors one readable card in a narrow day. */
  readonly compactSidecarWidth?: number | undefined;
}

/** Derive the number of collision columns that remain readable at the measured lane width. */
function readableColumnCount(
  laneWidth: number,
  leadingInset: number,
  minimumReadableItemWidth: number,
): number {
  const usableWidth = Math.max(0, laneWidth - Math.max(0, leadingInset) - OUTER_GUTTER_PIXELS);
  const minimumWidth =
    minimumReadableItemWidth > 0 ? minimumReadableItemWidth : MINIMUM_READABLE_ITEM_WIDTH;
  return Math.max(2, Math.floor(usableWidth / minimumWidth));
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

/** Reserve direct columns, replacing the last one with a requested hidden event when needed. */
function visibleSourceColumns(
  cluster: readonly PositionedScheduleItem[],
  directColumnCount: number,
  promotedItemId?: string,
): Map<number, number> {
  const promotedColumn = cluster.find(({ item }) => item.id === promotedItemId)?.placement
    .columnIndex;
  const sourceColumns = Array.from({ length: directColumnCount }, (_, index) => index);
  if (promotedColumn !== undefined && promotedColumn >= directColumnCount) {
    sourceColumns[directColumnCount - 1] = promotedColumn;
  }
  return new Map(
    sourceColumns.map((sourceColumn, displayedColumn) => [sourceColumn, displayedColumn]),
  );
}

/** Keep hidden events near their own start rather than one distant cluster-wide disclosure. */
function overflowGroupsForCluster(
  clusterId: string,
  hidden: readonly PositionedScheduleItem[],
  directColumnCount: number,
  displayedColumnCount: number,
  compactSidecarWidth?: number,
): DenseScheduleOverflowGroup[] {
  return localOverflowBuckets(hidden).flatMap((items, bucketIndex) => {
    const first = items[0];
    if (!first) return [];
    const overflowId = `${clusterId}:overflow:${String(bucketIndex)}`;
    return [
      {
        clusterId: overflowId,
        items,
        top: first.top,
        height: Math.min(40, first.height),
        placement: {
          id: overflowId,
          columnIndex: directColumnCount,
          columnCount: displayedColumnCount,
          trailingSidecarWidth: compactSidecarWidth,
        },
      },
    ];
  });
}

/** Arrange one independent collision cluster after the lane has fixed its available width. */
function arrangeCluster(
  clusterId: string,
  cluster: readonly PositionedScheduleItem[],
  laneWidth: number,
  options: DenseScheduleArrangementOptions,
): DenseScheduleArrangement {
  const requiredColumns = Math.max(1, ...cluster.map(({ placement }) => placement.columnCount));
  const compactSidecarWidth =
    requiredColumns > 1 && (options.compactSidecarWidth ?? 0) > 0
      ? options.compactSidecarWidth
      : undefined;
  const capacity = readableColumnCount(
    laneWidth,
    options.leadingInsetByCluster?.get(clusterId) ?? 0,
    options.minimumReadableItemWidth ?? MINIMUM_READABLE_ITEM_WIDTH,
  );
  if (requiredColumns <= capacity && compactSidecarWidth === undefined) {
    return { directItems: cluster, overflowGroups: [] };
  }

  const directColumnCount = compactSidecarWidth === undefined ? capacity - 1 : 1;
  const displayedColumnCount = compactSidecarWidth === undefined ? capacity : 2;
  const displayedColumns = visibleSourceColumns(cluster, directColumnCount, options.promotedItemId);
  const directItems = cluster
    .filter(({ placement }) => displayedColumns.has(placement.columnIndex))
    .map((positioned) => ({
      ...positioned,
      placement: {
        ...positioned.placement,
        columnIndex: displayedColumns.get(positioned.placement.columnIndex) ?? 0,
        columnCount: displayedColumnCount,
        trailingSidecarWidth: compactSidecarWidth,
      },
    }));
  const hidden = cluster.filter(({ placement }) => !displayedColumns.has(placement.columnIndex));
  return {
    directItems,
    overflowGroups: overflowGroupsForCluster(
      clusterId,
      hidden,
      directColumnCount,
      displayedColumnCount,
      compactSidecarWidth,
    ),
  };
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
  const clusters = new Map<string, PositionedScheduleItem[]>();
  for (const positioned of positionedItems) {
    const cluster = clusters.get(positioned.clusterId) ?? [];
    cluster.push(positioned);
    clusters.set(positioned.clusterId, cluster);
  }

  const directItems: PositionedScheduleItem[] = [];
  const overflowGroups: DenseScheduleOverflowGroup[] = [];
  for (const [clusterId, cluster] of clusters) {
    const arranged = arrangeCluster(clusterId, cluster, laneWidth, options);
    directItems.push(...arranged.directItems);
    overflowGroups.push(...arranged.overflowGroups);
  }

  return { directItems, overflowGroups };
}
