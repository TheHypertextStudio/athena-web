'use client';

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { pixelsToMinutes } from './scheduling-geometry';
import {
  SCHEDULING_TOUCH_LONG_PRESS_MS,
  SCHEDULING_TOUCH_PAN_ACTIVATION_PIXELS,
} from './scheduling-gesture-runtime';
import {
  deriveSchedulingRegionSelection,
  detachSchedulingRegionSession,
  releaseSchedulingRegionCapture,
  type SchedulingRegionPreview,
  type SchedulingRegionSession,
} from './scheduling-region-session';
import type { ScheduleLane, SchedulingCanvasProps } from './scheduling-types';

interface UseSchedulingRegionSelectionOptions {
  readonly lanes: readonly ScheduleLane[];
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly onSelectRegion?: SchedulingCanvasProps['onSelectRegion'];
}

interface SchedulingRegionSelectionController {
  readonly preview: SchedulingRegionPreview | null;
  readonly onPointerDown: (lane: ScheduleLane, event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

/** Own one pointer-exclusive, cancellable scheduling-region selection session. */
export function useSchedulingRegionSelection(
  options: UseSchedulingRegionSelectionOptions,
): SchedulingRegionSelectionController {
  const optionsRef = useRef(options);
  const sessionRef = useRef<SchedulingRegionSession | null>(null);
  const suppressClickRef = useRef(false);
  const mountedRef = useRef(true);
  const [preview, setPreview] = useState<SchedulingRegionPreview | null>(null);

  useLayoutEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const showPreview = useCallback((next: SchedulingRegionPreview | null): void => {
    if (mountedRef.current) setPreview(next);
  }, []);

  const stopSession = useCallback((shouldReleaseCapture = true, shouldRender = true): void => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    detachSchedulingRegionSession(session);
    if (shouldReleaseCapture) releaseSchedulingRegionCapture(session);
    if (shouldRender && mountedRef.current) setPreview(null);
  }, []);

  const onPointerDown = useCallback(
    (lane: ScheduleLane, event: ReactPointerEvent<HTMLDivElement>): void => {
      const currentOptions = optionsRef.current;
      const selectable =
        currentOptions.onSelectRegion !== undefined && event.target === event.currentTarget;
      const touchPannable = event.pointerType === 'touch';
      if ((!selectable && !touchPannable) || sessionRef.current || event.button !== 0) return;
      suppressClickRef.current = false;
      if (!touchPannable) event.preventDefault();
      const rectTop = event.currentTarget.getBoundingClientRect().top;
      const originMinutes = pixelsToMinutes(
        event.clientY - rectTop,
        currentOptions.pixelsPerHour,
        currentOptions.snapMinutes,
      );
      const cancel = (shouldReleaseCapture = true): void => {
        if (sessionRef.current === session) stopSession(shouldReleaseCapture);
      };
      const selectionAt = (clientY: number): SchedulingRegionPreview => {
        const currentMinutes = pixelsToMinutes(
          clientY - session.rectTop,
          session.pixelsPerHour,
          session.snapMinutes,
        );
        return deriveSchedulingRegionSelection(
          session.laneId,
          session.originMinutes,
          currentMinutes,
          session.snapMinutes,
        );
      };
      const move = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId !== session.pointerId) return;
        const deltaX = pointerEvent.clientX - session.originX;
        const deltaY = pointerEvent.clientY - session.originY;
        if (!session.active) {
          if (
            session.pointerType !== 'touch' ||
            Math.hypot(deltaX, deltaY) < SCHEDULING_TOUCH_PAN_ACTIVATION_PIXELS
          )
            return;
          session.panning = true;
          suppressClickRef.current = true;
          if (session.longPressTimer !== null) {
            window.clearTimeout(session.longPressTimer);
            session.longPressTimer = null;
          }
          pointerEvent.preventDefault();
          if (session.viewport) {
            session.viewport.scrollLeft = session.originScrollLeft - deltaX;
            session.viewport.scrollTop = session.originScrollTop - deltaY;
          }
          return;
        }
        pointerEvent.preventDefault();
        showPreview(selectionAt(pointerEvent.clientY));
      };
      const up = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId !== session.pointerId) return;
        if (!session.active) {
          stopSession();
          return;
        }
        const finalPreview = selectionAt(pointerEvent.clientY);
        const latestOptions = optionsRef.current;
        const currentLane = latestOptions.lanes.find(
          (candidate) => candidate.id === session.laneId,
        );
        const onSelectRegion = latestOptions.onSelectRegion;
        stopSession();
        if (currentLane && onSelectRegion) {
          onSelectRegion({
            lane: currentLane,
            startMinutes: finalPreview.startMinutes,
            endMinutes: finalPreview.endMinutes,
          });
        }
      };
      const pointerCancel = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId === session.pointerId) cancel();
      };
      const escape = (keyboardEvent: KeyboardEvent): void => {
        if (keyboardEvent.key === 'Escape') cancel();
      };
      const session: SchedulingRegionSession = {
        pointerId: event.pointerId,
        laneId: lane.id,
        target: event.currentTarget,
        viewport: currentOptions.viewportRef.current,
        rectTop,
        originX: event.clientX,
        originY: event.clientY,
        originScrollLeft: currentOptions.viewportRef.current?.scrollLeft ?? 0,
        originScrollTop: currentOptions.viewportRef.current?.scrollTop ?? 0,
        originMinutes,
        pixelsPerHour: currentOptions.pixelsPerHour,
        snapMinutes: currentOptions.snapMinutes,
        pointerType: event.pointerType,
        selectable,
        active: selectable && event.pointerType !== 'touch',
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
      try {
        session.target.setPointerCapture(session.pointerId);
        session.captured = true;
      } catch {
        session.captured = false;
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', pointerCancel);
      window.addEventListener('keydown', escape);
      session.target.addEventListener('lostpointercapture', session.lostCapture);
      if (session.active) {
        showPreview(
          deriveSchedulingRegionSelection(
            lane.id,
            originMinutes,
            originMinutes,
            session.snapMinutes,
          ),
        );
      } else if (session.selectable) {
        session.longPressTimer = window.setTimeout(() => {
          if (sessionRef.current !== session || session.panning) return;
          session.longPressTimer = null;
          session.active = true;
          showPreview(
            deriveSchedulingRegionSelection(
              lane.id,
              originMinutes,
              originMinutes,
              session.snapMinutes,
            ),
          );
        }, SCHEDULING_TOUCH_LONG_PRESS_MS);
      }
    },
    [showPreview, stopSession],
  );

  useEffect(() => {
    const session = sessionRef.current;
    if (
      session &&
      (!options.lanes.some((lane) => lane.id === session.laneId) ||
        (session.selectable && !options.onSelectRegion))
    ) {
      stopSession();
    }
  }, [options.lanes, options.onSelectRegion, stopSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopSession(true, false);
    };
  }, [stopSession]);

  return {
    preview,
    onPointerDown,
    onClickCapture: (event) => {
      const shouldSuppress = suppressClickRef.current;
      suppressClickRef.current = false;
      if (!shouldSuppress || event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
