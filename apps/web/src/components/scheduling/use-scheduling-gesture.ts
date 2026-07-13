'use client';

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { deriveGesturePreview, formatSchedulingGestureAnnouncement } from './scheduling-gesture';
import {
  autoScrollSchedulingViewport,
  deriveKeyboardGesturePreview,
  detachSchedulingPointerSession,
  releaseSchedulingPointerSession,
  SCHEDULING_GESTURE_ACTIVATION_PIXELS,
  schedulingPreviewsEqual,
  type SchedulingGestureController,
  type SchedulingPointerSession,
  type UseSchedulingGestureOptions,
} from './scheduling-gesture-runtime';
import type { ScheduleGestureMode, ScheduleGesturePreview } from './scheduling-types';

/** Own the armed-to-active pointer lifecycle for one scheduling item. */
export function useSchedulingGesture(
  options: UseSchedulingGestureOptions,
): SchedulingGestureController {
  const optionsRef = useRef(options);
  const [preview, setPreview] = useState<ScheduleGesturePreview | null>(null);
  const previewRef = useRef<ScheduleGesturePreview | null>(null);
  const previewModeRef = useRef<ScheduleGestureMode | null>(null);
  const sessionRef = useRef<SchedulingPointerSession | null>(null);
  const suppressBodyClickRef = useRef(false);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const showPreview = useCallback(
    (next: ScheduleGesturePreview | null, mode?: ScheduleGestureMode) => {
      if (
        schedulingPreviewsEqual(previewRef.current, next) &&
        previewModeRef.current === (mode ?? null)
      )
        return;
      previewRef.current = next;
      previewModeRef.current = next ? (mode ?? null) : null;
      if (mountedRef.current) setPreview(next);
      const current = optionsRef.current;
      const targetLane = next ? current.lanes[next.laneIndex] : undefined;
      current.onAnnouncementChange(
        next && mode && targetLane
          ? formatSchedulingGestureAnnouncement(mode, current.item.title, targetLane.label, next)
          : '',
      );
    },
    [],
  );

  const stopSession = useCallback(
    (releaseCapture = true, renderPreview = true): void => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      detachSchedulingPointerSession(session);
      if (releaseCapture) releaseSchedulingPointerSession(session);
      if (renderPreview) showPreview(null);
      else {
        previewRef.current = null;
        previewModeRef.current = null;
        optionsRef.current.onAnnouncementChange('');
      }
    },
    [showPreview],
  );

  const commitPreview = useCallback(
    (mode: ScheduleGestureMode, next: ScheduleGesturePreview, announce = false): void => {
      const current = optionsRef.current;
      const targetLane = current.lanes[next.laneIndex];
      const sourceEditable = current.editable && (current.lane.editable ?? true);
      if (!sourceEditable || !targetLane || !(targetLane.editable ?? true)) return;
      const changed =
        next.laneIndex !== current.laneIndex ||
        next.startMinutes !== current.bounds.startMinutes ||
        next.endMinutes !== current.bounds.endMinutes;
      if (!changed) return;
      if (announce) {
        current.onAnnouncementChange(
          formatSchedulingGestureAnnouncement(mode, current.item.title, targetLane.label, next),
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
    },
    [],
  );

  const beginPointer = useCallback(
    (mode: ScheduleGestureMode, event: ReactPointerEvent<HTMLButtonElement>): void => {
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
        originX: event.clientX,
        originY: event.clientY,
        originViewportX,
        originContentX: originViewportX + viewport.scrollLeft - current.gutterWidth,
        originScrollLeft: viewport.scrollLeft,
        originScrollTop: viewport.scrollTop,
        active: false,
        captured: false,
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
    },
    [commitPreview, showPreview, stopSession],
  );

  const adjustByKeyboard = useCallback(
    (mode: ScheduleGestureMode, event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      const current = optionsRef.current;
      const next = deriveKeyboardGesturePreview(current, mode, event.key);
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (next) commitPreview(mode, next, true);
    },
    [commitPreview],
  );

  useEffect(() => {
    if (!options.lanes.some((candidate) => candidate.id === options.lane.id)) stopSession();
  }, [options.lane.id, options.lanes, stopSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopSession(true, false);
    };
  }, [stopSession]);

  return {
    preview,
    previewMode: preview ? previewModeRef.current : null,
    onBodyPointerDown: (event) => {
      beginPointer('move', event);
    },
    onBodyClick: (event) => {
      if (suppressBodyClickRef.current && event.detail !== 0) {
        suppressBodyClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      suppressBodyClickRef.current = false;
      const current = optionsRef.current;
      current.onOpenItem?.({ item: current.item, lane: current.lane });
    },
    onMovePointerDown: (event) => {
      beginPointer('move', event);
    },
    onMoveKeyDown: (event) => {
      adjustByKeyboard('move', event);
    },
    onStartResizePointerDown: (event) => {
      beginPointer('resize-start', event);
    },
    onStartResizeKeyDown: (event) => {
      adjustByKeyboard('resize-start', event);
    },
    onEndResizePointerDown: (event) => {
      beginPointer('resize-end', event);
    },
    onEndResizeKeyDown: (event) => {
      adjustByKeyboard('resize-end', event);
    },
  };
}
