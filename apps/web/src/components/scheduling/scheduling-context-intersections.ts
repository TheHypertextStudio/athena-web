import type { ScheduleMinuteBounds } from './scheduling-types';

/** A projected minute range associated with an opaque consumer-owned context identifier. */
export interface ScheduleContextRegion extends ScheduleMinuteBounds {
  /** Stable consumer-owned identifier whose meaning remains opaque to scheduling. */
  readonly id: string;
}

/** One ordered portion of a schedule range covered by one context or by no context. */
export interface ScheduleContextSegment extends ScheduleMinuteBounds {
  /** Covering region identifier, or `null` for an uncovered neutral portion. */
  readonly contextId: string | null;
}

/** Return whether minute bounds describe a finite positive range. */
function hasPositiveFiniteBounds(bounds: ScheduleMinuteBounds): boolean {
  return (
    Number.isFinite(bounds.startMinutes) &&
    Number.isFinite(bounds.endMinutes) &&
    bounds.endMinutes > bounds.startMinutes
  );
}

/** Sort context precedence independently of provider response order. */
function compareContextRegions(left: ScheduleContextRegion, right: ScheduleContextRegion): number {
  if (left.startMinutes !== right.startMinutes) return left.startMinutes - right.startMinutes;
  if (left.endMinutes !== right.endMinutes) return left.endMinutes - right.endMinutes;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/**
 * Partition one projected schedule range into ordered context and neutral portions.
 *
 * @remarks
 * Every returned segment is clipped to `bounds`, and adjacent boundaries never produce
 * zero-duration output. Gaps remain present with `contextId: null`, which lets a visual composer
 * split decoration without splitting the schedule item itself. When malformed consumers supply
 * overlapping regions, the earliest start wins; ties resolve by earliest end and then opaque ID.
 * This precedence makes output stable without assigning meaning to any context identifier.
 *
 * @param bounds - Projected range to partition, usually one timed item's bounds in a lane.
 * @param contextRegions - Projected context ranges whose identifiers remain opaque to scheduling.
 * @returns Ordered positive-duration segments covering the complete input range.
 */
export function partitionScheduleRangeByContext(
  bounds: ScheduleMinuteBounds,
  contextRegions: readonly ScheduleContextRegion[],
): ScheduleContextSegment[] {
  if (!hasPositiveFiniteBounds(bounds)) return [];

  const clippedRegions = contextRegions
    .filter(hasPositiveFiniteBounds)
    .sort(compareContextRegions)
    .map((region) => ({
      ...region,
      startMinutes: Math.max(bounds.startMinutes, region.startMinutes),
      endMinutes: Math.min(bounds.endMinutes, region.endMinutes),
    }))
    .filter(hasPositiveFiniteBounds);
  const boundaries = [
    ...new Set([
      bounds.startMinutes,
      ...clippedRegions.flatMap((region) => [region.startMinutes, region.endMinutes]),
      bounds.endMinutes,
    ]),
  ].sort((left, right) => left - right);
  const segments: ScheduleContextSegment[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMinutes = boundaries[index];
    const endMinutes = boundaries[index + 1];
    if (startMinutes === undefined || endMinutes === undefined || endMinutes <= startMinutes) {
      continue;
    }
    const contextId =
      clippedRegions.find(
        (region) => region.startMinutes < endMinutes && region.endMinutes > startMinutes,
      )?.id ?? null;
    const previous = segments.at(-1);
    if (previous?.contextId === contextId && previous.endMinutes === startMinutes) {
      segments[segments.length - 1] = {
        contextId,
        startMinutes: previous.startMinutes,
        endMinutes,
      };
    } else {
      segments.push({ contextId, startMinutes, endMinutes });
    }
  }

  return segments;
}
