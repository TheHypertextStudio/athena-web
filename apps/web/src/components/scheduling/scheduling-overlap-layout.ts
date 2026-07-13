import { itemBoundsInLane, type ScheduleItemLaneBounds } from './scheduling-date-lanes';
import { minutesToPixels } from './scheduling-geometry';
import type { ScheduleItem, ScheduleLane } from './scheduling-types';

/** One timed item's bounds after clipping it to a scheduling lane. */
export interface ScheduleOverlapInput {
  /** Stable item identifier carried into the resulting placement. */
  readonly id: string;
  /** Inclusive wall-minute position at which the lane segment starts. */
  readonly startMinutes: number;
  /** Exclusive wall-minute position at which the lane segment truly ends. */
  readonly endMinutes: number;
}

/** One item's deterministic column inside its transitive visual-overlap cluster. */
export interface ScheduleOverlapPlacement {
  /** Stable item identifier from the corresponding input. */
  readonly id: string;
  /** Zero-indexed visual column assigned to the item. */
  readonly columnIndex: number;
  /** Peak concurrency of the item's cluster. */
  readonly columnCount: number;
}

/** Inline horizontal geometry for one collision column. */
export interface ScheduleOverlapHorizontalStyle {
  readonly left: number | string;
  readonly width: string;
}

/** One lane item with vertical geometry and collision placement computed exactly once. */
export interface PositionedScheduleItem {
  readonly item: ScheduleItem;
  readonly bounds: ScheduleItemLaneBounds;
  readonly top: number;
  readonly height: number;
  readonly placement: ScheduleOverlapPlacement;
}

/** An overlap input annotated with the end of its minimum rendered box. */
interface VisualInterval extends ScheduleOverlapInput {
  readonly effectiveEndMinutes: number;
}

/** Keep computed CSS geometry concise and deterministic across equivalent renders. */
function formatCssNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}

/**
 * Convert a collision column into inset geometry with four-pixel outer and internal gutters.
 *
 * @param placement - Stable overlap column produced for one item.
 * @returns Explicit left and width values; callers never need a competing right inset.
 */
export function scheduleOverlapHorizontalStyle(
  placement: ScheduleOverlapPlacement,
): ScheduleOverlapHorizontalStyle {
  const columnCount = Math.max(1, placement.columnCount);
  const columnIndex = Math.max(0, Math.min(columnCount - 1, placement.columnIndex));
  if (columnCount === 1) return { left: 4, width: 'calc(100% - 8px)' };

  const columnPercentage = 100 / columnCount;
  const widthReduction = 4 + 4 / columnCount;
  const leftOffset = 4 - (4 * columnIndex) / columnCount;
  return {
    left:
      columnIndex === 0
        ? 4
        : `calc(${formatCssNumber(columnPercentage * columnIndex)}% + ${formatCssNumber(leftOffset)}px)`,
    width: `calc(${formatCssNumber(columnPercentage)}% - ${formatCssNumber(widthReduction)}px)`,
  };
}

/** Sort intervals independently of provider or API response order. */
function compareIntervals(a: VisualInterval, b: VisualInterval): number {
  if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
  if (a.effectiveEndMinutes !== b.effectiveEndMinutes) {
    return b.effectiveEndMinutes - a.effectiveEndMinutes;
  }
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Assign the lowest available column to each interval in one connected cluster. */
function placeCluster(cluster: readonly VisualInterval[]): ScheduleOverlapPlacement[] {
  const columnEnds: number[] = [];
  const columnIndexes: number[] = [];

  for (const item of cluster) {
    const availableColumn = columnEnds.findIndex((endMinutes) => endMinutes <= item.startMinutes);
    const columnIndex = availableColumn === -1 ? columnEnds.length : availableColumn;
    columnEnds[columnIndex] = item.effectiveEndMinutes;
    columnIndexes.push(columnIndex);
  }

  return cluster.map((item, index) => ({
    id: item.id,
    columnIndex: columnIndexes[index] ?? 0,
    columnCount: columnEnds.length,
  }));
}

/**
 * Lay out already-clipped lane intervals into stable visual-overlap columns.
 *
 * @remarks
 * Minimum rendered height participates in collision detection, so two short events never paint on
 * top of one another at low zoom. True or effective bounds that merely touch remain disjoint.
 * Each lane calls this function independently and consumes its canonical output order directly,
 * keeping DOM and keyboard order independent of upstream item ordering.
 *
 * @param inputs - Timed item bounds clipped to one lane in the canvas display timezone.
 * @param pixelsPerHour - Current vertical scale for the shared scheduling canvas.
 * @param minimumInteractivePixels - Minimum rendered item height used by the event card.
 * @returns Stable placements ordered by start, effective end descending, and id ascending.
 */
export function layoutScheduleOverlaps(
  inputs: readonly ScheduleOverlapInput[],
  pixelsPerHour: number,
  minimumInteractivePixels: number,
): ScheduleOverlapPlacement[] {
  if (inputs.length === 0) return [];

  const safePixelsPerHour = Math.max(1, pixelsPerHour);
  const minimumMinutes = (Math.max(0, minimumInteractivePixels) / safePixelsPerHour) * 60;
  const sorted: VisualInterval[] = inputs
    .map((input) => ({
      ...input,
      effectiveEndMinutes: Math.max(input.endMinutes, input.startMinutes + minimumMinutes),
    }))
    .sort(compareIntervals);

  const placements: ScheduleOverlapPlacement[] = [];
  let cluster: VisualInterval[] = [];
  let clusterEndMinutes = Number.NEGATIVE_INFINITY;

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMinutes >= clusterEndMinutes) {
      placements.push(...placeCluster(cluster));
      cluster = [];
      clusterEndMinutes = Number.NEGATIVE_INFINITY;
    }
    cluster.push(item);
    clusterEndMinutes = Math.max(clusterEndMinutes, item.effectiveEndMinutes);
  }

  if (cluster.length > 0) placements.push(...placeCluster(cluster));
  return placements;
}

/**
 * Clip, position, and canonically order every timed item in one scheduling lane.
 *
 * @param lane - The independent date/resource lane being laid out.
 * @param displayTimezone - Shared timezone used to clip every item to the lane date.
 * @param pixelsPerHour - Current vertical zoom used for top, height, and visual collision bounds.
 * @param minimumInteractivePixels - Shared minimum item height.
 * @returns Timed item geometry in canonical overlap-layout order.
 */
export function positionScheduleLaneItems(
  lane: ScheduleLane,
  displayTimezone: string,
  pixelsPerHour: number,
  minimumInteractivePixels: number,
): PositionedScheduleItem[] {
  const positionedById = new Map<string, Omit<PositionedScheduleItem, 'placement'>>();

  for (const item of lane.items) {
    const bounds = itemBoundsInLane(item, lane, displayTimezone);
    if (!bounds) continue;
    positionedById.set(item.id, {
      item,
      bounds,
      top: minutesToPixels(bounds.startMinutes, pixelsPerHour),
      height: Math.max(
        minutesToPixels(bounds.endMinutes - bounds.startMinutes, pixelsPerHour),
        minimumInteractivePixels,
      ),
    });
  }

  const placements = layoutScheduleOverlaps(
    [...positionedById.values()].map(({ item, bounds }) => ({
      id: item.id,
      startMinutes: bounds.startMinutes,
      endMinutes: bounds.endMinutes,
    })),
    pixelsPerHour,
    minimumInteractivePixels,
  );

  return placements.flatMap((placement) => {
    const positioned = positionedById.get(placement.id);
    return positioned ? [{ ...positioned, placement }] : [];
  });
}
