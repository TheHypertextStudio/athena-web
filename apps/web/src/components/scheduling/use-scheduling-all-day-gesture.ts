'use client';

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type {
  ScheduleAllDayGestureMode,
  ScheduleAllDayGesturePreview,
} from './scheduling-all-day-editing';
import {
  allDayPreviewsEqual,
  commitAllDayGesture,
  deriveAllDayKeyboardPreview,
  formatAllDayGestureAnnouncement,
  type UseSchedulingAllDayGestureOptions,
} from './scheduling-all-day-gesture-runtime';
import {
  beginAllDayPointerSession,
  endAllDayPointerSession,
  type SchedulingAllDayPointerSession,
} from './scheduling-all-day-pointer-session';

/** Event bindings and live calendar-date preview returned for one all-day segment. */
export interface SchedulingAllDayGestureController {
  readonly preview: ScheduleAllDayGesturePreview | null;
  readonly previewMode: ScheduleAllDayGestureMode | null;
  readonly onBodyPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onBodyClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly onMovePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onMoveKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  readonly onStartResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onStartResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  readonly onEndResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onEndResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

/** Coordinate preview state around the isolated pointer, keyboard, and commit runtimes. */
export function useSchedulingAllDayGesture(
  options: UseSchedulingAllDayGestureOptions,
): SchedulingAllDayGestureController {
  const optionsRef = useRef(options);
  const previewRef = useRef<ScheduleAllDayGesturePreview | null>(null);
  const modeRef = useRef<ScheduleAllDayGestureMode | null>(null);
  const sessionRef = useRef<SchedulingAllDayPointerSession | null>(null);
  const suppressBodyClickRef = useRef(false);
  const mountedRef = useRef(true);
  const [preview, setPreview] = useState<ScheduleAllDayGesturePreview | null>(null);

  useLayoutEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const showPreview = useCallback(
    (next: ScheduleAllDayGesturePreview | null, mode?: ScheduleAllDayGestureMode): void => {
      if (allDayPreviewsEqual(previewRef.current, next) && modeRef.current === (mode ?? null))
        return;
      previewRef.current = next;
      modeRef.current = next ? (mode ?? null) : null;
      if (mountedRef.current) setPreview(next);
      const current = optionsRef.current;
      current.onAnnouncementChange(
        next && mode ? formatAllDayGestureAnnouncement(current, mode, next) : '',
      );
    },
    [],
  );

  const stopSession = useCallback(
    (releaseCapture = true, renderPreview = true): void => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      endAllDayPointerSession(session, releaseCapture);
      if (renderPreview) showPreview(null);
      else {
        previewRef.current = null;
        modeRef.current = null;
        optionsRef.current.onAnnouncementChange('');
      }
    },
    [showPreview],
  );

  const commitPreview = useCallback(
    (
      mode: ScheduleAllDayGestureMode,
      next: ScheduleAllDayGesturePreview,
      announce = false,
    ): void => {
      commitAllDayGesture(optionsRef.current, mode, next, announce);
    },
    [],
  );

  const beginPointer = useCallback(
    (mode: ScheduleAllDayGestureMode, event: ReactPointerEvent<HTMLButtonElement>): void => {
      beginAllDayPointerSession({
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
    (mode: ScheduleAllDayGestureMode, event: ReactKeyboardEvent<HTMLButtonElement>): void => {
      const next = deriveAllDayKeyboardPreview(optionsRef.current, mode, event);
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
    if (
      options.item.id !== session.sourceItemId ||
      options.item.startsAt !== session.sourceStartsAt ||
      options.item.endsAt !== session.sourceEndsAt ||
      options.lane.id !== session.sourceLaneId
    ) {
      stopSession();
    }
  }, [options.item.endsAt, options.item.id, options.item.startsAt, options.lane.id, stopSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopSession(true, false);
    };
  }, [stopSession]);

  return {
    preview,
    previewMode: preview ? modeRef.current : null,
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
