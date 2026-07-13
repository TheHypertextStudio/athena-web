'use client';

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { formatSchedulingGestureAnnouncement } from './scheduling-gesture';
import { commitSchedulingGesture } from './scheduling-gesture-commit';
import {
  deriveKeyboardGesturePreview,
  schedulingPreviewsEqual,
  type SchedulingGestureController,
  type SchedulingPointerSession,
  type UseSchedulingGestureOptions,
} from './scheduling-gesture-runtime';
import {
  beginSchedulingPointerSession,
  endSchedulingPointerSession,
} from './scheduling-pointer-session';
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
      if (!next || !mode || !targetLane) {
        current.onAnnouncementChange('');
        return;
      }
      const presentation = current.presentPreviewTimeRange(mode, next);
      current.onAnnouncementChange(
        presentation.valid
          ? formatSchedulingGestureAnnouncement(
              mode,
              current.item.title,
              targetLane.label,
              presentation.label,
            )
          : (presentation.announcement ?? ''),
      );
    },
    [],
  );

  const stopSession = useCallback(
    (releaseCapture = true, renderPreview = true): void => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      endSchedulingPointerSession(session, releaseCapture);
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
      commitSchedulingGesture(optionsRef.current, mode, next, announce);
    },
    [],
  );

  const beginPointer = useCallback(
    (
      mode: ScheduleGestureMode,
      event: Parameters<SchedulingGestureController['onBodyPointerDown']>[0],
    ): void => {
      beginSchedulingPointerSession({
        mode,
        event,
        optionsRef,
        sessionRef,
        previewRef,
        suppressBodyClickRef,
        showPreview,
        stopSession,
        commitPreview,
      });
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
    const session = sessionRef.current;
    if (!session) return;
    const sourceChanged =
      options.item.id !== session.sourceItemId ||
      options.lane.id !== session.sourceLaneId ||
      options.bounds.startMinutes !== session.sourceStartMinutes ||
      options.bounds.endMinutes !== session.sourceEndMinutes;
    if (
      sourceChanged ||
      !options.lanes.some((candidate) => candidate.id === session.sourceLaneId)
    ) {
      stopSession();
    }
  }, [
    options.bounds.endMinutes,
    options.bounds.startMinutes,
    options.item.id,
    options.lane.id,
    options.laneIndex,
    options.lanes,
    stopSession,
  ]);

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
