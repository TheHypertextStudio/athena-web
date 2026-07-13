import type { ScheduleItemLaneBounds } from './scheduling-date-lanes';
import { moveScheduleInstantRange } from './scheduling-exact-move';
import { resizeScheduleInstantRange } from './scheduling-exact-resize';
import {
  resolveScheduleWallInstant,
  resolveScheduleWallTime,
  scheduleInstantAt,
  scheduleWallPositionForInstant,
} from './scheduling-wall-time';
import type {
  ScheduleGestureMode,
  ScheduleGesturePreview,
  ScheduleGestureTimePresentation,
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

type SchedulePreviewRangeResolution =
  | { readonly kind: 'resolved'; readonly range: ScheduleInstantRange }
  | { readonly kind: 'skipped' | 'repeated' | 'invalid' };

const REPEATED_EDIT_GUIDANCE =
  'That time repeats because clocks change. Open the item to choose Earlier or Later.';
const SKIPPED_EDIT_GUIDANCE =
  'That time does not exist because clocks change. Open the item to choose another time.';
const INVALID_EDIT_GUIDANCE = 'That edit cannot be placed at this time. Open the item to edit it.';

/** Return the short zone name emitted for one exact instant. */
function shortZoneName(formatter: Intl.DateTimeFormat, instant: Date): string | undefined {
  return formatter.formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value;
}

/** Return whether an exact instant occupies one of a zone's repeated wall-clock positions. */
function isRepeatedWallPosition(instant: string, timezone: string): boolean {
  const position = scheduleWallPositionForInstant(instant, timezone);
  return position
    ? resolveScheduleWallTime(position.date, position.wallMinutes, timezone)?.kind === 'repeated'
    : false;
}

/** Format one exact instant, adding its short zone when the wall position is repeated. */
export function formatScheduleInstantTime(instant: string, timezone: string): string | null {
  const date = new Date(instant);
  if (Number.isNaN(date.valueOf())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      ...(isRepeatedWallPosition(instant, timezone) ? { timeZoneName: 'short' as const } : {}),
    }).format(date);
  } catch {
    return null;
  }
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

/** Resolve exact instants and the reason an ambiguous live preview cannot commit. */
function previewRange(
  options: ScheduleItemTimeRangeOptions,
  base: ScheduleInstantRange,
): SchedulePreviewRangeResolution {
  const { item, preview, previewMode, laneIndex, bounds, lanes, displayTimezone } = options;
  if (!preview || !previewMode) return { kind: 'resolved', range: base };
  if (
    preview.laneIndex === laneIndex &&
    preview.startMinutes === bounds.startMinutes &&
    preview.endMinutes === bounds.endMinutes
  ) {
    return { kind: 'resolved', range: base };
  }

  const targetLane = lanes[preview.laneIndex];
  if (!targetLane) return { kind: 'invalid' };
  const exactItemRange = { startsAt: item.startsAt, endsAt: item.endsAt };
  if (previewMode === 'move') {
    const target = resolveScheduleWallInstant(
      targetLane.date,
      preview.startMinutes,
      displayTimezone,
      item.startsAt,
    );
    if (target.kind !== 'resolved') return target;
    const moved = moveScheduleInstantRange({
      ...exactItemRange,
      targetDate: targetLane.date,
      startMinutes: preview.startMinutes,
      displayTimezone,
    });
    return moved ? { kind: 'resolved', range: moved } : { kind: 'invalid' };
  }
  const edge = previewMode === 'resize-start' ? 'start' : 'end';
  const edgeMinutes = edge === 'start' ? preview.startMinutes : preview.endMinutes;
  const target = resolveScheduleWallInstant(
    targetLane.date,
    edgeMinutes,
    displayTimezone,
    edge === 'start' ? item.startsAt : item.endsAt,
  );
  if (target.kind !== 'resolved') return target;
  const resized = resizeScheduleInstantRange({
    ...exactItemRange,
    edge,
    targetDate: targetLane.date,
    edgeMinutes,
    displayTimezone,
  });
  return resized ? { kind: 'resolved', range: resized } : { kind: 'invalid' };
}

/** Present the exact label and commit policy represented by one scheduling card. */
export function presentScheduleItemTimeRange(
  options: ScheduleItemTimeRangeOptions,
): ScheduleGestureTimePresentation {
  const base = clippedItemRange(options.item, options.lane, options.displayTimezone);
  if (!base)
    return { label: 'Unavailable time', valid: false, announcement: INVALID_EDIT_GUIDANCE };
  const resolution = previewRange(options, base);
  if (resolution.kind !== 'resolved') {
    const announcement =
      resolution.kind === 'repeated'
        ? REPEATED_EDIT_GUIDANCE
        : resolution.kind === 'skipped'
          ? SKIPPED_EDIT_GUIDANCE
          : INVALID_EDIT_GUIDANCE;
    return { label: 'Unavailable time', valid: false, announcement };
  }
  const label = formatScheduleInstantRange(
    resolution.range.startsAt,
    resolution.range.endsAt,
    options.displayTimezone,
  );
  return label
    ? { label, valid: true }
    : { label: 'Unavailable time', valid: false, announcement: INVALID_EDIT_GUIDANCE };
}

/** Format the exact item or preview instants represented by one scheduling card. */
export function formatScheduleItemTimeRange(options: ScheduleItemTimeRangeOptions): string {
  return presentScheduleItemTimeRange(options).label;
}
