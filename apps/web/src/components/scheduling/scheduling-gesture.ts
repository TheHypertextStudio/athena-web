import { MINUTES_PER_DAY } from './scheduling-geometry';
import type { ScheduleGestureMode, ScheduleGesturePreview } from './scheduling-types';

const WALL_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  timeZone: 'UTC',
  hour: 'numeric',
  minute: '2-digit',
});

/** Original lane and wall-clock bounds for one gesture. */
export interface SchedulingGestureBounds {
  readonly laneIndex: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** Signed raw pointer movement since a gesture was armed. */
export interface SchedulingGestureDelta {
  readonly x: number;
  readonly y: number;
}

/** Minimal lane policy needed by the pure gesture controller. */
export interface SchedulingGestureLanePolicy {
  readonly id: string;
  readonly editable?: boolean;
}

/** Horizontal viewport and scroll geometry captured for one gesture preview. */
export interface SchedulingGestureLaneGeometry {
  readonly laneWidth: number;
  readonly gutterWidth: number;
  readonly viewportWidth: number;
  readonly originViewportX: number;
  readonly originContentX: number;
  readonly scrollDelta: SchedulingGestureDelta;
}

/** Complete pure input for {@link deriveGesturePreview}. */
export interface DeriveGesturePreviewOptions {
  readonly mode: ScheduleGestureMode;
  readonly original: SchedulingGestureBounds;
  readonly delta: SchedulingGestureDelta;
  readonly laneGeometry: SchedulingGestureLaneGeometry;
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  readonly itemEditable: boolean;
  readonly lanes: readonly SchedulingGestureLanePolicy[];
}

/** Round signed minutes symmetrically when a delta is exactly half one snap. */
function snapPixelDelta(pixels: number, pixelsPerHour: number, snapMinutes: number): number {
  const safePixelsPerHour = Math.max(1, pixelsPerHour);
  const safeSnap = Math.max(1, snapMinutes);
  const rawMinutes = (pixels / safePixelsPerHour) * 60;
  const snapCount = Math.floor(Math.abs(rawMinutes) / safeSnap + 0.5);
  return Math.sign(rawMinutes) * snapCount * safeSnap;
}

/** Return whether a lane policy permits a direct manipulation. */
function laneIsEditable(lane: SchedulingGestureLanePolicy | undefined): boolean {
  return lane !== undefined && (lane.editable ?? true);
}

/** Resolve a moved pointer to a lane without clamping gutter or exterior positions. */
function targetLaneIndex({
  delta,
  laneGeometry,
  lanes,
}: DeriveGesturePreviewOptions): number | null {
  const currentViewportX = laneGeometry.originViewportX + delta.x;
  if (
    currentViewportX < laneGeometry.gutterWidth ||
    currentViewportX >= laneGeometry.viewportWidth
  ) {
    return null;
  }
  const contentX = laneGeometry.originContentX + delta.x + laneGeometry.scrollDelta.x;
  const contentWidth = lanes.length * laneGeometry.laneWidth;
  if (contentX < 0 || contentX >= contentWidth || laneGeometry.laneWidth <= 0) return null;
  return Math.floor(contentX / laneGeometry.laneWidth);
}

/** Keep a moved duration intact while constraining it to one 24-hour lane. */
function movedBounds(
  original: SchedulingGestureBounds,
  deltaMinutes: number,
): Pick<ScheduleGesturePreview, 'startMinutes' | 'endMinutes'> {
  const duration = Math.max(
    0,
    Math.min(MINUTES_PER_DAY, original.endMinutes - original.startMinutes),
  );
  const startMinutes = Math.max(
    0,
    Math.min(MINUTES_PER_DAY - duration, original.startMinutes + deltaMinutes),
  );
  return { startMinutes, endMinutes: startMinutes + duration };
}

/**
 * Derive one valid live move or edge-resize preview from pointer and viewport geometry.
 *
 * @remarks
 * Move targets in the sticky gutter, outside the viewport/content, or in read-only lanes return
 * `null`. Resize gestures stay in their source lane. A zero effective resize delta returns the
 * original short duration before minimum-duration enforcement, so overview zoom never mutates a
 * five-minute item merely because it was pressed.
 */
export function deriveGesturePreview(
  options: DeriveGesturePreviewOptions,
): ScheduleGesturePreview | null {
  const { itemEditable, lanes, mode, original, laneGeometry, delta, pixelsPerHour, snapMinutes } =
    options;
  if (!itemEditable || !laneIsEditable(lanes[original.laneIndex])) return null;

  const deltaMinutes = snapPixelDelta(
    delta.y + laneGeometry.scrollDelta.y,
    pixelsPerHour,
    snapMinutes,
  );
  if (mode === 'move') {
    const laneIndex = targetLaneIndex(options);
    if (laneIndex === null || !laneIsEditable(lanes[laneIndex])) return null;
    return { laneIndex, ...movedBounds(original, deltaMinutes) };
  }

  if (deltaMinutes === 0) {
    return {
      laneIndex: original.laneIndex,
      startMinutes: original.startMinutes,
      endMinutes: original.endMinutes,
    };
  }

  const minimumDuration = Math.min(MINUTES_PER_DAY, Math.max(1, snapMinutes));
  if (mode === 'resize-start') {
    return {
      laneIndex: original.laneIndex,
      startMinutes: Math.max(
        0,
        Math.min(original.endMinutes - minimumDuration, original.startMinutes + deltaMinutes),
      ),
      endMinutes: original.endMinutes,
    };
  }
  return {
    laneIndex: original.laneIndex,
    startMinutes: original.startMinutes,
    endMinutes: Math.min(
      MINUTES_PER_DAY,
      Math.max(original.startMinutes + minimumDuration, original.endMinutes + deltaMinutes),
    ),
  };
}

/** Format wall-minute bounds with the viewer's locale conventions. */
export function formatScheduleWallTimeRange(
  bounds: Pick<ScheduleGesturePreview, 'startMinutes' | 'endMinutes'>,
): string {
  const atWallMinutes = (minutes: number): Date =>
    new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
  return `${WALL_TIME_FORMATTER.format(atWallMinutes(bounds.startMinutes))} – ${WALL_TIME_FORMATTER.format(atWallMinutes(bounds.endMinutes))}`;
}

/** Build fixed semantic copy for one valid live gesture preview. */
export function formatSchedulingGestureAnnouncement(
  mode: ScheduleGestureMode,
  itemTitle: string,
  laneLabel: string,
  timeRange: string,
): string {
  if (mode === 'move') return `Moving ${itemTitle} to ${laneLabel}, ${timeRange}.`;
  const edge = mode === 'resize-start' ? 'start' : 'end';
  return `Resizing ${edge} of ${itemTitle} in ${laneLabel}, ${timeRange}.`;
}
