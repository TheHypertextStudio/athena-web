/**
 * `calendar/lane-layout` — pure overlap/lane layout for the full calendar view's timeline.
 *
 * @remarks
 * Timed calendar items overlap arbitrarily (a synced meeting inside a native focus block, three
 * back-to-back-ish events), and the timeline needs stable columns so overlapping items stack
 * side-by-side without ever hiding one another's text. This module owns exactly that placement
 * decision — which lane (0-indexed column) each item sits in, and how many lanes its overlap
 * cluster needs — as a pure function over `{id, startsAt, endsAt}` triples, independent of the
 * React tree that positions the resulting boxes. `calendar-timeline.tsx` turns `{lane, laneCount}`
 * into a `left`/`width` percentage; this module never touches pixels.
 *
 * The algorithm is the standard two-pass interval-graph greedy coloring calendar UIs use (the same
 * shape Google Calendar's day view uses): sort by start, sweep into overlap "clusters" (a maximal
 * run of items connected transitively by time overlap), then greedily assign each cluster's items
 * the lowest free lane (reusing a lane the moment its occupant ends). A cluster's `laneCount` is
 * the number of lanes concurrency actually required — not the cluster's item count — so a chain
 * like A-overlaps-B, B-overlaps-C, A-and-C-disjoint still lays out in 2 lanes, not 3.
 */

/** One item's time bounds, as the layout needs them — nothing else. */
export interface LaneLayoutInput {
  /** Stable item id, carried through to the placement. */
  readonly id: string;
  /** ISO 8601 start timestamp. */
  readonly startsAt: string;
  /** ISO 8601 end timestamp. */
  readonly endsAt: string;
}

/** One item's computed lane placement. */
export interface LanePlacement {
  /** The item id this placement is for. */
  readonly id: string;
  /** The item's 0-indexed lane (column) within its overlap cluster. */
  readonly lane: number;
  /** The number of lanes the item's overlap cluster required — the same value for every item in it. */
  readonly laneCount: number;
}

/** An input item annotated with its parsed millisecond bounds, for sorting/comparison. */
interface TimedItem extends LaneLayoutInput {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Greedily assign lanes to one overlap cluster (already sorted by start, then end).
 *
 * @remarks
 * Walks the cluster in start order, reusing the lowest-indexed lane whose current occupant has
 * already ended by the time the next item starts (adjacent/touching items free their lane), else
 * opening a new lane. The number of lanes opened is the cluster's `laneCount`.
 */
function assignLanes(cluster: readonly TimedItem[]): LanePlacement[] {
  const laneEndsMs: number[] = [];
  const laneByItem = new Map<string, number>();
  for (const item of cluster) {
    const freeLane = laneEndsMs.findIndex((endMs) => endMs <= item.startMs);
    const lane = freeLane === -1 ? laneEndsMs.length : freeLane;
    laneEndsMs[lane] = item.endMs;
    laneByItem.set(item.id, lane);
  }
  const laneCount = laneEndsMs.length;
  return cluster.map((item) => ({ id: item.id, lane: laneByItem.get(item.id) ?? 0, laneCount }));
}

/**
 * Compute overlap/lane placements for a set of timed items.
 *
 * @remarks
 * Pure and order-independent on input (the result order follows start-time order, not input
 * order). Items with identical or reversed bounds are tolerated — {@link assignLanes} only ever
 * compares millisecond instants, never asserts `endMs > startMs`.
 *
 * @param items - The items to place, with ISO `startsAt`/`endsAt` bounds.
 * @returns each item's `{id, lane, laneCount}`, one entry per input item.
 */
export function layoutLanes(items: readonly LaneLayoutInput[]): LanePlacement[] {
  if (items.length === 0) return [];

  const sorted: TimedItem[] = items
    .map((item) => ({
      ...item,
      startMs: new Date(item.startsAt).getTime(),
      endMs: new Date(item.endsAt).getTime(),
    }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const placements: LanePlacement[] = [];
  let cluster: TimedItem[] = [];
  let clusterEndMs = -Infinity;

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMs >= clusterEndMs) {
      placements.push(...assignLanes(cluster));
      cluster = [];
      clusterEndMs = -Infinity;
    }
    cluster.push(item);
    clusterEndMs = Math.max(clusterEndMs, item.endMs);
  }
  if (cluster.length > 0) placements.push(...assignLanes(cluster));

  return placements;
}
