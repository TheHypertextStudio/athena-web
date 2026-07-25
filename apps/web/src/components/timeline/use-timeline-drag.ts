'use client';

/**
 * `timeline` — the pointer interaction that makes scheduling a *gesture* rather than a form.
 *
 * @remarks
 * On a planning timeline, dragging is how work gets scheduled: move a bar to shift it, drag an
 * edge to change a boundary, drag across empty track to give an undated row its first dates. This
 * hook is the single implementation of all of those, because they differ only in which endpoints
 * the pointer delta is applied to.
 *
 * Two properties matter more than the mechanics:
 *
 * - **A drag is never rejected.** There is no snap-back, no forbidden region, and no confirmation.
 *   Constraint violations are consequences to be surfaced afterwards (see `cascade.ts`), not
 *   reasons to refuse the gesture. The only correction applied is a one-day minimum span, which
 *   keeps a resize from inverting itself mid-drag.
 * - **The pointer is captured**, so a fast drag that leaves the row — or the window — still tracks
 *   and still commits, instead of stranding the bar somewhere the user did not intend.
 *
 * Dates snap to UTC day boundaries, matching the resolution the wire format carries, so a drag
 * always lands on a real calendar date.
 */
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from 'react';

import type { TimelineSpan } from './timeline-catalog';
import { DAY_MS, type TimeWindow, snapDown } from './time-scale';

/** Which endpoints of a span a drag moves. */
export type DragMode = 'move' | 'resize-start' | 'resize-end' | 'create';

/** A drag in progress, carrying the live preview span. */
export interface TimelineDrag {
  /** The row being dragged. */
  readonly id: string;
  /** What the drag is doing to the span. */
  readonly mode: DragMode;
  /** The span as it currently reads — what the canvas paints while the pointer is down. */
  readonly span: TimelineSpan;
  /** Whether the pointer has actually moved, distinguishing a drag from a click. */
  readonly moved: boolean;
}

/** Options for {@link useTimelineDrag}. */
export interface UseTimelineDragOptions {
  /** The active viewport, for converting pixel deltas into durations. */
  window: TimeWindow;
  /** The plot area element, whose width defines the pixels-per-millisecond ratio. */
  trackRef: RefObject<HTMLElement | null>;
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
  /** Begin a drag from a pointer-down on a bar, an edge handle, or empty track. */
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

/** Apply a pointer delta to a span according to the drag mode, snapped to UTC days. */
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
  onCommit,
}: UseTimelineDragOptions): UseTimelineDragResult {
  const [drag, setDrag] = useState<TimelineDrag | null>(null);
  // Set on a drag that actually moved, cleared by the click it suppresses.
  const suppressClick = useRef(false);

  const consumeDragClick = useCallback((): boolean => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  const startDrag = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      id: string,
      mode: DragMode,
      span: TimelineSpan,
    ): void => {
      // Only the primary button initiates a drag; let everything else through untouched.
      if (event.button !== 0) return;
      const track = trackRef.current;
      if (!track) return;
      const width = track.getBoundingClientRect().width;
      if (width <= 0) return;

      event.preventDefault();
      event.stopPropagation();

      const originX = event.clientX;
      const msPerPx = (window.max - window.min) / width;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      let live: TimelineSpan = span;
      let moved = false;

      const handleMove = (moveEvent: globalThis.PointerEvent): void => {
        const deltaPx = moveEvent.clientX - originX;
        if (!moved && Math.abs(deltaPx) < 1) return;
        moved = true;
        live = applyDelta(span, deltaPx * msPerPx, mode);
        setDrag({ id, mode, span: live, moved: true });
      };

      const handleUp = (): void => {
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', handleUp);
        target.removeEventListener('pointercancel', handleUp);
        if (target.hasPointerCapture(event.pointerId)) {
          target.releasePointerCapture(event.pointerId);
        }
        setDrag(null);
        if (moved) {
          suppressClick.current = true;
          onCommit(id, live);
        }
      };

      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', handleUp);
      target.addEventListener('pointercancel', handleUp);
      setDrag({ id, mode, span, moved: false });
    },
    [onCommit, trackRef, window.max, window.min],
  );

  return { drag, startDrag, consumeDragClick };
}
