import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

import {
  scheduleAllDayRange,
  type ScheduleAllDayGestureMode,
  type ScheduleAllDayGesturePreview,
} from './scheduling-all-day-editing';
import {
  allDayGestureModeEnabled,
  allDayPreviewAtIndex,
  type UseSchedulingAllDayGestureOptions,
} from './scheduling-all-day-gesture-runtime';
import {
  autoScrollSchedulingViewport,
  SCHEDULING_GESTURE_ACTIVATION_PIXELS,
  SCHEDULING_TOUCH_LONG_PRESS_MS,
  SCHEDULING_TOUCH_PAN_ACTIVATION_PIXELS,
} from './scheduling-gesture-runtime';

/** Browser listeners and capture state owned by one armed all-day pointer. */
export interface SchedulingAllDayPointerSession {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly target: HTMLButtonElement;
  readonly sourceItemId: string;
  readonly sourceLaneId: string;
  readonly sourceStartsAt: string;
  readonly sourceEndsAt: string;
  readonly originX: number;
  readonly originY: number;
  readonly originScrollLeft: number;
  readonly originScrollTop: number;
  active: boolean;
  panning: boolean;
  captured: boolean;
  longPressTimer: number | null;
  readonly move: (event: PointerEvent) => void;
  readonly up: (event: PointerEvent) => void;
  readonly cancel: (event: PointerEvent) => void;
  readonly escape: (event: KeyboardEvent) => void;
  readonly lostCapture: (event: PointerEvent) => void;
}

interface BeginAllDayPointerSessionOptions {
  readonly mode: ScheduleAllDayGestureMode;
  readonly event: ReactPointerEvent<HTMLButtonElement>;
  readonly optionsRef: RefObject<UseSchedulingAllDayGestureOptions>;
  readonly sessionRef: RefObject<SchedulingAllDayPointerSession | null>;
  readonly previewRef: RefObject<ScheduleAllDayGesturePreview | null>;
  readonly suppressBodyClickRef: RefObject<boolean>;
  readonly showPreview: (
    preview: ScheduleAllDayGesturePreview | null,
    mode?: ScheduleAllDayGestureMode,
  ) => void;
  readonly stopSession: (releaseCapture?: boolean, renderPreview?: boolean) => void;
  readonly commitPreview: (
    mode: ScheduleAllDayGestureMode,
    preview: ScheduleAllDayGesturePreview,
  ) => void;
}

/** Remove listeners and release capture for one completed all-day pointer session. */
export function endAllDayPointerSession(
  session: SchedulingAllDayPointerSession,
  releaseCapture: boolean,
): void {
  if (session.longPressTimer !== null) window.clearTimeout(session.longPressTimer);
  window.removeEventListener('pointermove', session.move);
  window.removeEventListener('pointerup', session.up);
  window.removeEventListener('pointercancel', session.cancel);
  window.removeEventListener('keydown', session.escape);
  session.target.removeEventListener('lostpointercapture', session.lostCapture);
  if (!releaseCapture || !session.captured) return;
  try {
    session.target.releasePointerCapture(session.pointerId);
  } catch {
    // The browser may release capture before a cancellation listener runs.
  }
}

/** Start one mouse, pen, or touch-long-press all-day editing session. */
export function beginAllDayPointerSession({
  mode,
  event,
  optionsRef,
  sessionRef,
  previewRef,
  suppressBodyClickRef,
  showPreview,
  stopSession,
  commitPreview,
}: BeginAllDayPointerSessionOptions): void {
  const current = optionsRef.current;
  if (!allDayGestureModeEnabled(current, mode) || event.button !== 0) return;
  stopSession();
  suppressBodyClickRef.current = false;
  showPreview(null);
  event.stopPropagation();
  const viewport = current.viewportRef.current;
  const range = scheduleAllDayRange(current.item, current.displayTimezone);
  if (!viewport || !range) return;

  const cancel = (releaseCapture = true): void => {
    if (sessionRef.current === session) stopSession(releaseCapture);
  };
  const move = (pointerEvent: PointerEvent): void => {
    if (pointerEvent.pointerId !== session.pointerId) return;
    const deltaX = pointerEvent.clientX - session.originX;
    const deltaY = pointerEvent.clientY - session.originY;
    if (!session.active) {
      if (session.pointerType === 'touch') {
        if (Math.hypot(deltaX, deltaY) < SCHEDULING_TOUCH_PAN_ACTIVATION_PIXELS) return;
        session.panning = true;
        suppressBodyClickRef.current = mode === 'move';
        if (session.longPressTimer !== null) {
          window.clearTimeout(session.longPressTimer);
          session.longPressTimer = null;
        }
        pointerEvent.preventDefault();
        viewport.scrollLeft = session.originScrollLeft - deltaX;
        viewport.scrollTop = session.originScrollTop - deltaY;
        return;
      }
      if (Math.hypot(deltaX, deltaY) < SCHEDULING_GESTURE_ACTIVATION_PIXELS) return;
      session.active = true;
      suppressBodyClickRef.current = mode === 'move';
      try {
        session.target.setPointerCapture(session.pointerId);
        session.captured = true;
      } catch {
        session.captured = false;
      }
    }
    pointerEvent.preventDefault();
    autoScrollSchedulingViewport(viewport, pointerEvent.clientX, pointerEvent.clientY);
    const latest = optionsRef.current;
    const latestRange = scheduleAllDayRange(latest.item, latest.displayTimezone);
    if (!latestRange || !latest.lanes.some((candidate) => candidate.id === latest.lane.id)) {
      cancel();
      return;
    }
    const scrolledDelta = viewport.scrollLeft - session.originScrollLeft;
    const laneDelta = Math.round((deltaX + scrolledDelta) / Math.max(1, latest.laneWidth));
    const targetLaneIndex = Math.max(
      0,
      Math.min(latest.lanes.length - 1, latest.laneIndex + laneDelta),
    );
    showPreview(allDayPreviewAtIndex(latest, mode, latestRange, targetLaneIndex), mode);
  };
  const up = (pointerEvent: PointerEvent): void => {
    if (pointerEvent.pointerId !== session.pointerId) return;
    const next = previewRef.current;
    const active = session.active;
    stopSession();
    if (active && next) commitPreview(mode, next);
  };
  const pointerCancel = (pointerEvent: PointerEvent): void => {
    if (pointerEvent.pointerId === session.pointerId) cancel();
  };
  const escape = (keyboardEvent: KeyboardEvent): void => {
    if (keyboardEvent.key === 'Escape') cancel();
  };
  const session: SchedulingAllDayPointerSession = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    target: event.currentTarget,
    sourceItemId: current.item.id,
    sourceLaneId: current.lane.id,
    sourceStartsAt: current.item.startsAt,
    sourceEndsAt: current.item.endsAt,
    originX: event.clientX,
    originY: event.clientY,
    originScrollLeft: viewport.scrollLeft,
    originScrollTop: viewport.scrollTop,
    active: false,
    panning: false,
    captured: false,
    longPressTimer: null,
    move,
    up,
    cancel: pointerCancel,
    escape,
    lostCapture: (captureEvent) => {
      if (captureEvent.pointerId === session.pointerId) cancel(false);
    },
  };
  sessionRef.current = session;
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', pointerCancel);
  window.addEventListener('keydown', escape);
  session.target.addEventListener('lostpointercapture', session.lostCapture);
  if (session.pointerType !== 'touch') return;
  try {
    session.target.setPointerCapture(session.pointerId);
    session.captured = true;
  } catch {
    session.captured = false;
  }
  session.longPressTimer = window.setTimeout(() => {
    if (sessionRef.current !== session || session.panning) return;
    const latest = optionsRef.current;
    const latestRange = scheduleAllDayRange(latest.item, latest.displayTimezone);
    if (
      !latestRange ||
      latest.item.id !== session.sourceItemId ||
      latest.item.startsAt !== session.sourceStartsAt ||
      latest.item.endsAt !== session.sourceEndsAt ||
      latest.lane.id !== session.sourceLaneId
    ) {
      stopSession();
      return;
    }
    session.longPressTimer = null;
    session.active = true;
    suppressBodyClickRef.current = mode === 'move';
    showPreview(allDayPreviewAtIndex(latest, mode, latestRange, latest.laneIndex), mode);
  }, SCHEDULING_TOUCH_LONG_PRESS_MS);
}
