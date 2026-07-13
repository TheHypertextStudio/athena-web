import { formatSchedulingGestureAnnouncement } from './scheduling-gesture';
import type { UseSchedulingGestureOptions } from './scheduling-gesture-runtime';
import type { ScheduleGestureMode, ScheduleGesturePreview } from './scheduling-types';

/** Commit one changed, permitted gesture through the canvas consumer callbacks. */
export function commitSchedulingGesture(
  current: UseSchedulingGestureOptions,
  mode: ScheduleGestureMode,
  next: ScheduleGesturePreview,
  announce = false,
): void {
  const targetLane = current.lanes[next.laneIndex];
  const sourceEditable = current.editable && (current.lane.editable ?? true);
  if (!sourceEditable || !targetLane || !(targetLane.editable ?? true)) return;
  const changed =
    next.laneIndex !== current.laneIndex ||
    next.startMinutes !== current.bounds.startMinutes ||
    next.endMinutes !== current.bounds.endMinutes;
  if (!changed) return;
  const presentation = current.presentPreviewTimeRange(mode, next);
  if (!presentation.valid) {
    current.onAnnouncementChange(presentation.announcement ?? 'That edit cannot be placed here.');
    return;
  }
  if (announce) {
    current.onAnnouncementChange(
      formatSchedulingGestureAnnouncement(
        mode,
        current.item.title,
        targetLane.label,
        presentation.label,
      ),
    );
  }
  if (mode === 'move') {
    current.onMoveItem?.({
      item: current.item,
      fromLane: current.lane,
      toLane: targetLane,
      startMinutes: next.startMinutes,
      endMinutes: next.endMinutes,
    });
    return;
  }
  current.onResizeItem?.({
    item: current.item,
    lane: current.lane,
    edge: mode === 'resize-start' ? 'start' : 'end',
    startMinutes: next.startMinutes,
    endMinutes: next.endMinutes,
  });
}
