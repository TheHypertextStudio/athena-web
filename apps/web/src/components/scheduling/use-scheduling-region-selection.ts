'use client';

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { MINUTES_PER_DAY, pixelsToMinutes } from './scheduling-geometry';
import type { ScheduleLane, SchedulingCanvasProps } from './scheduling-types';

interface RegionSelectionPreview {
  readonly laneId: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

interface UseSchedulingRegionSelectionOptions {
  readonly lanes: readonly ScheduleLane[];
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  readonly onSelectRegion?: SchedulingCanvasProps['onSelectRegion'];
}

interface RegionSelectionSession {
  readonly pointerId: number;
  readonly laneId: string;
  readonly target: HTMLElement;
  readonly rectTop: number;
  readonly originMinutes: number;
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  captured: boolean;
  readonly move: (event: PointerEvent) => void;
  readonly up: (event: PointerEvent) => void;
  readonly cancel: (event: PointerEvent) => void;
  readonly escape: (event: KeyboardEvent) => void;
  readonly lostCapture: (event: PointerEvent) => void;
}

interface SchedulingRegionSelectionController {
  readonly preview: RegionSelectionPreview | null;
  readonly onPointerDown: (lane: ScheduleLane, event: ReactPointerEvent<HTMLDivElement>) => void;
}

function deriveSelection(
  laneId: string,
  originMinutes: number,
  currentMinutes: number,
  snapMinutes: number,
): RegionSelectionPreview {
  let startMinutes = Math.min(originMinutes, currentMinutes);
  let endMinutes = Math.max(originMinutes, currentMinutes);
  if (startMinutes === endMinutes) {
    if (endMinutes === MINUTES_PER_DAY) startMinutes -= snapMinutes;
    else endMinutes += snapMinutes;
  }
  return { laneId, startMinutes, endMinutes };
}

function detachSession(session: RegionSelectionSession): void {
  window.removeEventListener('pointermove', session.move);
  window.removeEventListener('pointerup', session.up);
  window.removeEventListener('pointercancel', session.cancel);
  window.removeEventListener('keydown', session.escape);
  session.target.removeEventListener('lostpointercapture', session.lostCapture);
}

function releaseCapture(session: RegionSelectionSession): void {
  if (!session.captured) return;
  try {
    session.target.releasePointerCapture(session.pointerId);
  } catch {
    // The browser may have released capture before cleanup observes the session ending.
  }
}

/** Own one pointer-exclusive, cancellable scheduling-region selection session. */
export function useSchedulingRegionSelection(
  options: UseSchedulingRegionSelectionOptions,
): SchedulingRegionSelectionController {
  const optionsRef = useRef(options);
  const sessionRef = useRef<RegionSelectionSession | null>(null);
  const mountedRef = useRef(true);
  const [preview, setPreview] = useState<RegionSelectionPreview | null>(null);

  useLayoutEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const showPreview = useCallback((next: RegionSelectionPreview | null): void => {
    if (mountedRef.current) setPreview(next);
  }, []);

  const stopSession = useCallback((shouldReleaseCapture = true, shouldRender = true): void => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    detachSession(session);
    if (shouldReleaseCapture) releaseCapture(session);
    if (shouldRender && mountedRef.current) setPreview(null);
  }, []);

  const onPointerDown = useCallback(
    (lane: ScheduleLane, event: ReactPointerEvent<HTMLDivElement>): void => {
      const currentOptions = optionsRef.current;
      if (
        !currentOptions.onSelectRegion ||
        sessionRef.current ||
        event.button !== 0 ||
        event.target !== event.currentTarget
      )
        return;
      event.preventDefault();
      const rectTop = event.currentTarget.getBoundingClientRect().top;
      const originMinutes = pixelsToMinutes(
        event.clientY - rectTop,
        currentOptions.pixelsPerHour,
        currentOptions.snapMinutes,
      );
      const cancel = (shouldReleaseCapture = true): void => {
        if (sessionRef.current === session) stopSession(shouldReleaseCapture);
      };
      const selectionAt = (clientY: number): RegionSelectionPreview => {
        const currentMinutes = pixelsToMinutes(
          clientY - session.rectTop,
          session.pixelsPerHour,
          session.snapMinutes,
        );
        return deriveSelection(
          session.laneId,
          session.originMinutes,
          currentMinutes,
          session.snapMinutes,
        );
      };
      const move = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId !== session.pointerId) return;
        pointerEvent.preventDefault();
        showPreview(selectionAt(pointerEvent.clientY));
      };
      const up = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId !== session.pointerId) return;
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
      const session: RegionSelectionSession = {
        pointerId: event.pointerId,
        laneId: lane.id,
        target: event.currentTarget,
        rectTop,
        originMinutes,
        pixelsPerHour: currentOptions.pixelsPerHour,
        snapMinutes: currentOptions.snapMinutes,
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
      showPreview(deriveSelection(lane.id, originMinutes, originMinutes, session.snapMinutes));
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
    },
    [showPreview, stopSession],
  );

  useEffect(() => {
    const session = sessionRef.current;
    if (
      session &&
      (!options.onSelectRegion || !options.lanes.some((lane) => lane.id === session.laneId))
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

  return { preview, onPointerDown };
}
