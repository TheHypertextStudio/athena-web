import type { ScheduleItemLaneBounds } from './scheduling-date-lanes';
import { scheduleInstantAt, scheduleWallPositionForInstant } from './scheduling-time-axis';
import type {
  ScheduleGestureMode,
  ScheduleGesturePreview,
  ScheduleItem,
  ScheduleLane,
} from './scheduling-types';

interface ScheduleItemTimeRangeOptions {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly laneIndex: number;
  readonly lanes: readonly ScheduleLane[];
  readonly displayTimezone: string;
  readonly bounds: ScheduleItemLaneBounds;
  readonly preview?: ScheduleGesturePreview | null;
  readonly previewMode?: ScheduleGestureMode | null;
}

interface ScheduleInstantRange {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Return the short zone name emitted for one exact instant. */
function shortZoneName(formatter: Intl.DateTimeFormat, instant: Date): string | undefined {
  return formatter.formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value;
}

/** Return whether an exact instant occupies one of a zone's repeated wall-clock positions. */
function isRepeatedWallPosition(instant: string, timezone: string): boolean {
  const position = scheduleWallPositionForInstant(instant, timezone);
  return (
    position !== null &&
    scheduleInstantAt(position.date, position.wallMinutes, timezone, 'reject') === null
  );
}

/** Format exact instants, adding short zone names whenever they disambiguate the range. */
export function formatScheduleInstantRange(
  startsAt: string,
  endsAt: string,
  timezone: string,
): string | null {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return null;

  try {
    const zoneFormatter = new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    const startZone = shortZoneName(zoneFormatter, start);
    const endZone = shortZoneName(zoneFormatter, end);
    const showZone =
      startZone !== endZone ||
      isRepeatedWallPosition(startsAt, timezone) ||
      isRepeatedWallPosition(endsAt, timezone);
    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      ...(showZone ? { timeZoneName: 'short' as const } : {}),
    });
    return `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
  } catch {
    return null;
  }
}

/** Resolve the exact clipped instants shown by an item before direct manipulation begins. */
function clippedItemRange(
  item: ScheduleItem,
  lane: ScheduleLane,
  timezone: string,
): ScheduleInstantRange | null {
  const startPosition = scheduleWallPositionForInstant(item.startsAt, timezone);
  const endPosition = scheduleWallPositionForInstant(item.endsAt, timezone);
  if (!startPosition || !endPosition) return null;
  const startsAt =
    startPosition.date === lane.date
      ? item.startsAt
      : scheduleInstantAt(lane.date, 0, timezone, 'reject');
  const endsAt =
    endPosition.date === lane.date
      ? item.endsAt
      : scheduleInstantAt(lane.date, 24 * 60, timezone, 'reject');
  return startsAt && endsAt ? { startsAt, endsAt } : null;
}

/** Resolve exact instants for a live preview without coercing skipped or repeated wall times. */
function previewRange(
  options: ScheduleItemTimeRangeOptions,
  base: ScheduleInstantRange,
): ScheduleInstantRange | null {
  const { preview, previewMode, laneIndex, bounds, lanes, displayTimezone } = options;
  if (!preview || !previewMode) return base;
  if (
    preview.laneIndex === laneIndex &&
    preview.startMinutes === bounds.startMinutes &&
    preview.endMinutes === bounds.endMinutes
  ) {
    return base;
  }

  const targetLane = lanes[preview.laneIndex];
  if (!targetLane) return null;
  const proposedStart = scheduleInstantAt(
    targetLane.date,
    preview.startMinutes,
    displayTimezone,
    'reject',
  );
  const proposedEnd = scheduleInstantAt(
    targetLane.date,
    preview.endMinutes,
    displayTimezone,
    'reject',
  );
  const startsAt = previewMode === 'resize-end' ? base.startsAt : proposedStart;
  const endsAt = previewMode === 'resize-start' ? base.endsAt : proposedEnd;
  return startsAt && endsAt ? { startsAt, endsAt } : null;
}

/** Format the exact item or preview instants represented by one scheduling card. */
export function formatScheduleItemTimeRange(options: ScheduleItemTimeRangeOptions): string {
  const base = clippedItemRange(options.item, options.lane, options.displayTimezone);
  if (!base) return 'Unavailable time';
  const range = previewRange(options, base);
  return range
    ? (formatScheduleInstantRange(range.startsAt, range.endsAt, options.displayTimezone) ??
        'Unavailable time')
    : 'Unavailable time';
}
