import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

import { deriveGesturePreview } from './scheduling-gesture';
import {
  autoScrollSchedulingViewport,
  detachSchedulingPointerSession,
  releaseSchedulingPointerSession,
  SCHEDULING_GESTURE_ACTIVATION_PIXELS,
  SCHEDULING_TOUCH_LONG_PRESS_MS,
  SCHEDULING_TOUCH_PAN_ACTIVATION_PIXELS,
  type SchedulingPointerSession,
  type UseSchedulingGestureOptions,
} from './scheduling-gesture-runtime';
import type { ScheduleGestureMode, ScheduleGesturePreview } from './scheduling-types';

interface BeginSchedulingPointerSessionOptions {
  readonly mode: ScheduleGestureMode;
  readonly event: ReactPointerEvent<HTMLButtonElement>;
  readonly optionsRef: RefObject<UseSchedulingGestureOptions>;
  readonly sessionRef: RefObject<SchedulingPointerSession | null>;
  readonly previewRef: RefObject<ScheduleGesturePreview | null>;
  readonly suppressBodyClickRef: RefObject<boolean>;
  readonly showPreview: (
    preview: ScheduleGesturePreview | null,
    mode?: ScheduleGestureMode,
  ) => void;
  readonly stopSession: (releaseCapture?: boolean, renderPreview?: boolean) => void;
  readonly commitPreview: (mode: ScheduleGestureMode, preview: ScheduleGesturePreview) => void;
}

/** Start and own one mouse, pen, or touch scheduling pointer session. */
export function beginSchedulingPointerSession({
  mode,
  event,
  optionsRef,
  sessionRef,
  previewRef,
  suppressBodyClickRef,
  showPreview,
  stopSession,
  commitPreview,
}: BeginSchedulingPointerSessionOptions): void {
  const current = optionsRef.current;
  const enabled =
    current.editable &&
    (mode === 'move' ? current.onMoveItem !== undefined : current.onResizeItem !== undefined);
  if (!enabled || event.button !== 0) return;
  stopSession();
  suppressBodyClickRef.current = false;
  showPreview(null);
  event.stopPropagation();
  const viewport = current.viewportRef.current;
  if (!viewport) return;
  const viewportRect = viewport.getBoundingClientRect();
  const viewportWidth =
    viewportRect.width ||
    viewport.clientWidth ||
    current.gutterWidth + current.laneWidth * current.lanes.length;
  const originViewportX = event.clientX - viewportRect.left;
  const cancel = (releaseCapture = true): void => {
    if (sessionRef.current !== session) return;
    stopSession(releaseCapture);
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
    if (!latest.lanes.some((candidate) => candidate.id === latest.lane.id)) {
      cancel();
      return;
    }
    showPreview(
      deriveGesturePreview({
        mode,
        original: { laneIndex: latest.laneIndex, ...latest.bounds },
        delta: { x: deltaX, y: deltaY },
        laneGeometry: {
          laneWidth: latest.laneWidth,
          gutterWidth: latest.gutterWidth,
          viewportWidth,
          originViewportX: session.originViewportX,
          originContentX: session.originContentX,
          scrollDelta: {
            x: viewport.scrollLeft - session.originScrollLeft,
            y: viewport.scrollTop - session.originScrollTop,
          },
        },
        pixelsPerHour: latest.pixelsPerHour,
        snapMinutes: latest.snapMinutes,
        itemEditable: latest.editable,
        lanes: latest.lanes,
      }),
      mode,
    );
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
  const session: SchedulingPointerSession = {
    pointerId: event.pointerId,
    target: event.currentTarget,
    sourceItemId: current.item.id,
    sourceLaneId: current.lane.id,
    sourceStartMinutes: current.bounds.startMinutes,
    sourceEndMinutes: current.bounds.endMinutes,
    originX: event.clientX,
    originY: event.clientY,
    originViewportX,
    originContentX: originViewportX + viewport.scrollLeft - current.gutterWidth,
    originScrollLeft: viewport.scrollLeft,
    originScrollTop: viewport.scrollTop,
    pointerType: event.pointerType,
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
    if (
      latest.item.id !== session.sourceItemId ||
      latest.lane.id !== session.sourceLaneId ||
      latest.lanes[latest.laneIndex]?.id !== session.sourceLaneId
    ) {
      stopSession();
      return;
    }
    session.longPressTimer = null;
    session.active = true;
    suppressBodyClickRef.current = mode === 'move';
    showPreview({ laneIndex: latest.laneIndex, ...latest.bounds }, mode);
  }, SCHEDULING_TOUCH_LONG_PRESS_MS);
}

/** Detach and optionally release a scheduling pointer session. */
export function endSchedulingPointerSession(
  session: SchedulingPointerSession,
  releaseCapture: boolean,
): void {
  detachSchedulingPointerSession(session);
  if (releaseCapture) releaseSchedulingPointerSession(session);
}
