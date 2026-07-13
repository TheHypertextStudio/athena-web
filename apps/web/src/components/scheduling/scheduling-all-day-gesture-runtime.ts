import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

import {
  deriveAllDayGesturePreview,
  formatAllDayDateRange,
  scheduleAllDayRange,
  type ScheduleAllDayGestureMode,
  type ScheduleAllDayGesturePreview,
  type ScheduleAllDayRange,
} from './scheduling-all-day-editing';
import type { ScheduleItem, ScheduleLane, SchedulingCanvasProps } from './scheduling-types';

/** Inputs needed to bind direct manipulation to one rendered all-day segment. */
export interface UseSchedulingAllDayGestureOptions {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly laneIndex: number;
  readonly lanes: readonly ScheduleLane[];
  readonly laneWidth: number;
  readonly displayTimezone: string;
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly canMove: boolean;
  readonly canResizeStart: boolean;
  readonly canResizeEnd: boolean;
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onMoveAllDayItem?: SchedulingCanvasProps['onMoveAllDayItem'];
  readonly onResizeAllDayItem?: SchedulingCanvasProps['onResizeAllDayItem'];
  readonly onAnnouncementChange: (announcement: string) => void;
}

/** Compare semantic all-day previews without relying on object identity. */
export function allDayPreviewsEqual(
  left: ScheduleAllDayGesturePreview | null,
  right: ScheduleAllDayGesturePreview | null,
): boolean {
  return (
    left?.laneIndex === right?.laneIndex &&
    left?.startDate === right?.startDate &&
    left?.endDate === right?.endDate
  );
}

/** Return whether one segment exposes the callback needed for a gesture mode. */
export function allDayGestureModeEnabled(
  options: UseSchedulingAllDayGestureOptions,
  mode: ScheduleAllDayGestureMode,
): boolean {
  if (mode === 'move') return options.canMove && options.onMoveAllDayItem !== undefined;
  if (mode === 'resize-start')
    return options.canResizeStart && options.onResizeAllDayItem !== undefined;
  return options.canResizeEnd && options.onResizeAllDayItem !== undefined;
}

/** Format the application-owned live-region copy for an all-day edit. */
export function formatAllDayGestureAnnouncement(
  options: UseSchedulingAllDayGestureOptions,
  mode: ScheduleAllDayGestureMode,
  preview: ScheduleAllDayGesturePreview,
): string {
  const targetLane = options.lanes[preview.laneIndex];
  if (!targetLane) return '';
  const verb =
    mode === 'move' ? 'Moving' : mode === 'resize-start' ? 'Resizing start of' : 'Resizing end of';
  return `${verb} ${options.item.title} to ${targetLane.label}, ${formatAllDayDateRange(preview.startDate, preview.endDate)}.`;
}

/** Derive a valid preview for one lane index using current consumer data. */
export function allDayPreviewAtIndex(
  options: UseSchedulingAllDayGestureOptions,
  mode: ScheduleAllDayGestureMode,
  range: ScheduleAllDayRange,
  targetLaneIndex: number,
): ScheduleAllDayGesturePreview | null {
  const targetLane = options.lanes[targetLaneIndex];
  return targetLane
    ? deriveAllDayGesturePreview({ mode, range, targetLane, targetLaneIndex })
    : null;
}

/** Commit one changed, permitted all-day gesture through consumer callbacks. */
export function commitAllDayGesture(
  options: UseSchedulingAllDayGestureOptions,
  mode: ScheduleAllDayGestureMode,
  preview: ScheduleAllDayGesturePreview,
  announce: boolean,
): void {
  const targetLane = options.lanes[preview.laneIndex];
  const range = scheduleAllDayRange(options.item, options.displayTimezone);
  if (
    !targetLane ||
    !range ||
    !allDayGestureModeEnabled(options, mode) ||
    !(targetLane.editable ?? true)
  )
    return;
  const datesChanged = preview.startDate !== range.startDate || preview.endDate !== range.endDate;
  const laneChanged = preview.laneIndex !== options.laneIndex;
  if (!datesChanged && !(mode === 'move' && laneChanged)) return;
  if (announce) {
    options.onAnnouncementChange(formatAllDayGestureAnnouncement(options, mode, preview));
  }
  if (mode === 'move') {
    options.onMoveAllDayItem?.({
      item: options.item,
      fromLane: options.lane,
      toLane: targetLane,
      startDate: preview.startDate,
      endDate: preview.endDate,
    });
    return;
  }
  options.onResizeAllDayItem?.({
    item: options.item,
    fromLane: options.lane,
    toLane: targetLane,
    edge: mode === 'resize-start' ? 'start' : 'end',
    startDate: preview.startDate,
    endDate: preview.endDate,
  });
}

/** Derive one adjacent editable-lane keyboard preview, or ignore an unrelated key. */
export function deriveAllDayKeyboardPreview(
  options: UseSchedulingAllDayGestureOptions,
  mode: ScheduleAllDayGestureMode,
  event: ReactKeyboardEvent<HTMLButtonElement>,
): ScheduleAllDayGesturePreview | null | undefined {
  const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (direction === 0) return undefined;
  const range = scheduleAllDayRange(options.item, options.displayTimezone);
  if (!range) return null;
  for (
    let index = options.laneIndex + direction;
    index >= 0 && index < options.lanes.length;
    index += direction
  ) {
    if (!(options.lanes[index]?.editable ?? true)) continue;
    return allDayPreviewAtIndex(options, mode, range, index);
  }
  return null;
}
