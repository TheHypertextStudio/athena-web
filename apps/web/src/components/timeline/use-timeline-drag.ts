'use client';

/**
 * `timeline` — the pointer interaction that makes scheduling a *gesture* rather than a form.
 *
 * @remarks
 * On a planning timeline, dragging is how work gets scheduled: move a bar to shift it, drag an
 * edge to change a boundary, drag across an undated row's empty lane to give it its first dates.
 * This hook is the single implementation of all of those, because they differ only in which
 * endpoints the pointer delta is applied to.
 *
 * Four properties matter more than the mechanics:
 *
 * - **A drag is never rejected.** There is no snap-back, no forbidden region, and no confirmation.
 *   Constraint violations are consequences to be surfaced afterwards (see `cascade.ts`), not
 *   reasons to refuse the gesture. The only correction applied is a one-day minimum span, which
 *   keeps a resize from inverting itself mid-drag.
 * - **The pointer is captured**, so a fast drag that leaves the row — or the window — still tracks
 *   and still commits, instead of stranding the bar somewhere the user did not intend.
 * - **The span is derived from the pointer's *date*, not from a pixel delta.** This is what lets
 *   the viewport move underneath a live drag: when the edge-zone auto-pan shifts the window ten
 *   days later, the date under a stationary pointer shifts with it and the bar follows. A cached
 *   pixels-per-millisecond ratio, which is how this was written before, silently desynchronises
 *   the instant anything pans.
 * - **The gesture publishes where the pointer is.** The canvas draws the drag preview and the drop
 *   indicator from that, so "what am I holding" and "where will it land" are answered from the one
 *   piece of state that already knows.
 *
 * Dates snap to UTC day boundaries, matching the resolution the wire format carries, so a drag
 * always lands on a real calendar date.
 */
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { TimelineSpan } from './timeline-catalog';
import { DAY_MS, type TimeWindow, snapDown } from './time-scale';
import type { TimelineAutoScroll } from './use-timeline-autoscroll';

/** Which endpoints of a span a drag moves. */
export type DragMode = 'move' | 'resize-start' | 'resize-end' | 'create';

/** A drag in progress, carrying the live preview span and the pointer it follows. */
export interface TimelineDrag {
  /** The row being dragged. */
  readonly id: string;
  /** What the drag is doing to the span. */
  readonly mode: DragMode;
  /** The span as it currently reads — what the canvas paints while the pointer is down. */
  readonly span: TimelineSpan;
  /** The span the row had when the gesture opened, for a before/after readout. */
  readonly origin: TimelineSpan;
  /** Whether the pointer has actually moved, distinguishing a drag from a click. */
  readonly moved: boolean;
  /** The pointer's viewport x, so the preview can follow it. */
  readonly pointerX: number;
  /** The pointer's viewport y. */
  readonly pointerY: number;
}

/** Options for {@link useTimelineDrag}. */
export interface UseTimelineDragOptions {
  /** The active viewport, for converting pointer positions into dates. */
  window: TimeWindow;
  /** The plot area element, whose box defines the pointer-to-date projection. */
  trackRef: RefObject<HTMLElement | null>;
  /** The shared edge-zone auto-scroller, driven for the life of the gesture. */
  autoScroll: TimelineAutoScroll;
  /**
   * Commit a completed drag.
   *
   * @remarks
   * Called on pointer-up only when the pointer actually moved, so a plain click on a bar still
   * behaves as navigation rather than a no-op reschedule.
   */
  onCommit: (id: string, span: TimelineSpan) => void;
}

/** The value returned by {@link useTimelineDrag}. */
export interface UseTimelineDragResult {
  /** The drag in progress, or `null` when idle. */
  drag: TimelineDrag | null;
  /** Begin a drag from a pointer-down on a bar, an edge handle, or an undated row's lane. */
  startDrag: (
    event: ReactPointerEvent<HTMLElement>,
    id: string,
    mode: DragMode,
    span: TimelineSpan,
  ) => void;
  /**
   * Whether the click now firing is the tail of a completed drag, consuming the flag.
   *
   * @remarks
   * A pointer-up after a drag still produces a `click`, which would otherwise navigate away the
   * instant a bar was dropped — the user would reschedule a Project and immediately be thrown into
   * its detail page. Activation handlers call this first and bail when it returns `true`.
   */
  consumeDragClick: () => boolean;
}

/** Apply a date delta to a span according to the drag mode, snapped to UTC days. */
function applyDelta(origin: TimelineSpan, deltaMs: number, mode: DragMode): TimelineSpan {
  if (mode === 'move') {
    const start = snapDown(origin.start + deltaMs, 'day');
    return { start, end: start + (origin.end - origin.start) };
  }
  if (mode === 'resize-start') {
    const start = Math.min(snapDown(origin.start + deltaMs, 'day'), origin.end - DAY_MS);
    return { start, end: origin.end };
  }
  // `resize-end` and `create` both extend the trailing edge from a fixed start.
  const end = Math.max(snapDown(origin.end + deltaMs, 'day'), origin.start + DAY_MS);
  return { start: origin.start, end };
}

/**
 * Drive move / resize / create drags over a timeline track.
 *
 * @param options - The {@link UseTimelineDragOptions}.
 * @returns the live {@link TimelineDrag} and the `startDrag` opener.
 */
export function useTimelineDrag({
  window,
  trackRef,
  autoScroll,
  onCommit,
}: UseTimelineDragOptions): UseTimelineDragResult {
  const [drag, setDrag] = useState<TimelineDrag | null>(null);
  // Set on a drag that actually moved, cleared by the click it suppresses.
  const suppressClick = useRef(false);
  // The live viewport, read inside pointer handlers that outlive the render they were created in.
  const windowRef = useRef(window);
  windowRef.current = window;
  // The recompute the auto-scroll loop calls each frame, so a stationary pointer parked in an
  // edge zone still re-derives its date as the window pans beneath it.
  const onFrame = useRef<(() => void) | null>(null);

  const consumeDragClick = useCallback((): boolean => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  /** The (unsnapped) instant under a viewport x, against the *current* window. */
  const dateAtClientX = useCallback(
    (clientX: number): number | null => {
      const track = trackRef.current;
      if (!track) return null;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const current = windowRef.current;
      return current.min + ((clientX - rect.left) / rect.width) * (current.max - current.min);
    },
    [trackRef],
  );

  const startDrag = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      id: string,
      mode: DragMode,
      span: TimelineSpan,
    ): void => {
      // Only the primary button initiates a drag; let everything else through untouched.
      if (event.button !== 0) return;
      const grabDate = dateAtClientX(event.clientX);
      if (grabDate === null) return;

      event.preventDefault();
      event.stopPropagation();

      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      let live: TimelineSpan = span;
      let moved = false;
      let pointerX = event.clientX;
      let pointerY = event.clientY;

      /** Re-derive the span from wherever the pointer now sits in the *current* window. */
      const project = (): void => {
        const now = dateAtClientX(pointerX);
        if (now === null) return;
        const next = applyDelta(span, now - grabDate, mode);
        // Days are the resolution, so most frames land on the span already drawn. Bailing keeps a
        // held-at-the-edge auto-pan from re-rendering the whole canvas sixty times a second.
        if (moved && next.start === live.start && next.end === live.end) return;
        live = next;
        moved = true;
        setDrag({ id, mode, span: live, origin: span, moved: true, pointerX, pointerY });
      };
      onFrame.current = project;

      const handleMove = (moveEvent: globalThis.PointerEvent): void => {
        const first = !moved && Math.abs(moveEvent.clientX - pointerX) < 1;
        pointerX = moveEvent.clientX;
        pointerY = moveEvent.clientY;
        autoScroll.track(pointerX, pointerY);
        // A sub-pixel jitter before the gesture has committed is a click, not a drag.
        if (first) return;
        project();
      };

      const handleUp = (): void => {
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', handleUp);
        target.removeEventListener('pointercancel', handleUp);
        if (target.hasPointerCapture(event.pointerId)) {
          target.releasePointerCapture(event.pointerId);
        }
        onFrame.current = null;
        autoScroll.stop();
        setDrag(null);
        if (moved) {
          suppressClick.current = true;
          onCommit(id, live);
        }
      };

      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', handleUp);
      target.addEventListener('pointercancel', handleUp);
      autoScroll.track(pointerX, pointerY);
      setDrag({ id, mode, span, origin: span, moved: false, pointerX, pointerY });
    },
    [autoScroll, dateAtClientX, onCommit],
  );

  // The auto-scroll loop owns the animation frame; this is how it reaches back into the gesture.
  useEffect(() => {
    autoScroll.setOnFrame(() => {
      onFrame.current?.();
    });
    return () => {
      autoScroll.setOnFrame(null);
    };
  }, [autoScroll]);

  return { drag, startDrag, consumeDragClick };
}
