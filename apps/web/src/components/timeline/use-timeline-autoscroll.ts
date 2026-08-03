'use client';

/**
 * `timeline` — edge-zone auto-scrolling, the one implementation every timeline drag uses.
 *
 * @remarks
 * A drag can only reach what is on screen. Without this, scheduling a row three months out means
 * dropping it somewhere wrong, zooming, and dragging again — so the gesture that is supposed to be
 * the fastest way to plan is the slowest. Holding the pointer near an edge instead moves the
 * viewport *under* the object, continuously, until the pointer leaves the zone or the drag ends.
 *
 * Both axes are driven from the same loop because they are the same gesture, but they move
 * different things, and that difference is structural rather than incidental:
 *
 * - **Vertical** scrolls the row list. Rows are a list; there is a scrollbar; this is ordinary
 *   scrolling.
 * - **Horizontal** *pans the time window*. The timeline has no horizontal scrollbar by design (see
 *   `timeline-canvas`): the plot is always exactly as wide as the viewport, and time is navigated
 *   by moving the window. So the horizontal edge zone shifts `[min, max]` rather than a
 *   `scrollLeft` — which is also why it can keep going forever in either direction instead of
 *   stopping at a track's end.
 *
 * Speed ramps with depth into the edge zone, so a pointer that merely brushes the boundary creeps
 * and one parked hard against it moves quickly. Both are driven by `requestAnimationFrame`, so the
 * rate is per-frame rather than per-pointer-event: a stationary pointer held at the edge keeps
 * scrolling even though the browser has stopped sending `pointermove`, which is exactly the case a
 * move-event-driven implementation gets wrong.
 */
import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';

/** How far from an edge, in pixels, the auto-scroll zone begins. */
export const AUTO_SCROLL_EDGE_PX = 64;
/** The fastest vertical scroll, in pixels per animation frame, at the very edge. */
const MAX_SCROLL_PX_PER_FRAME = 16;
/** The fastest horizontal pan, as a fraction of the visible window, per animation frame. */
const MAX_PAN_FRACTION_PER_FRAME = 0.01;

/**
 * How hard to push, given a pointer coordinate and the two edges it sits between.
 *
 * @remarks
 * Returns a signed 0–1 intensity: negative toward `low`, positive toward `high`, zero in the calm
 * middle. Squaring the depth gives a gentle ramp near the boundary and full speed only when the
 * pointer is genuinely pinned to the edge, which keeps a normal drag across the plot from
 * accidentally triggering a scroll.
 */
function edgeIntensity(position: number, low: number, high: number): number {
  if (high - low < AUTO_SCROLL_EDGE_PX * 2) return 0;
  if (position < low + AUTO_SCROLL_EDGE_PX) {
    const depth = (low + AUTO_SCROLL_EDGE_PX - position) / AUTO_SCROLL_EDGE_PX;
    return -(Math.min(1, depth) ** 2);
  }
  if (position > high - AUTO_SCROLL_EDGE_PX) {
    const depth = (position - (high - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX;
    return Math.min(1, depth) ** 2;
  }
  return 0;
}

/** Options for {@link useTimelineAutoScroll}. */
export interface UseTimelineAutoScrollOptions {
  /** The vertical scroll container holding the row list. */
  readonly scrollRef: RefObject<HTMLElement | null>;
  /** The plot area, whose left/right edges define the horizontal zones. */
  readonly trackRef: RefObject<HTMLElement | null>;
  /** Pan the visible time window by a fraction of its own span (negative pans earlier). */
  readonly onPan: (fraction: number) => void;
}

/** The value returned by {@link useTimelineAutoScroll}. */
export interface TimelineAutoScroll {
  /**
   * Report the pointer's viewport position; starts and steers the loop as needed.
   *
   * @remarks
   * Idempotent and cheap — safe to call from every `pointermove` and every `dragover`.
   */
  readonly track: (clientX: number, clientY: number) => void;
  /** End auto-scrolling (on drop, cancel, or when the pointer leaves the surface). */
  readonly stop: () => void;
  /**
   * Register the callback run after each frame's scroll and pan have been applied.
   *
   * @remarks
   * This is how a gesture stays correct while the world moves under a *stationary* pointer. The
   * browser sends no `pointermove` for a pointer that is not moving, so anything derived from the
   * pointer's position — the date beneath it, the row beneath it — would freeze while the window
   * panned past it. The loop already runs a frame; the gesture recomputes on it.
   */
  readonly setOnFrame: (callback: (() => void) | null) => void;
}

/**
 * Auto-scroll the row list and auto-pan the time window while a drag sits near an edge.
 *
 * @param options - The {@link UseTimelineAutoScrollOptions}.
 * @returns the {@link TimelineAutoScroll} controls.
 */
export function useTimelineAutoScroll({
  scrollRef,
  trackRef,
  onPan,
}: UseTimelineAutoScrollOptions): TimelineAutoScroll {
  const frame = useRef<number | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const onFrame = useRef<(() => void) | null>(null);
  // Read through a ref so the rAF loop never closes over a stale pan callback, and so `track`
  // stays referentially stable for the whole gesture.
  const panRef = useRef(onPan);
  panRef.current = onPan;

  const stop = useCallback((): void => {
    pointer.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  const step = useCallback((): void => {
    frame.current = null;
    const at = pointer.current;
    const scroller = scrollRef.current;
    const track = trackRef.current;
    if (!at) return;

    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const intensity = edgeIntensity(at.y, box.top, box.bottom);
      if (intensity !== 0) scroller.scrollTop += intensity * MAX_SCROLL_PX_PER_FRAME;
    }
    if (track) {
      const box = track.getBoundingClientRect();
      const intensity = edgeIntensity(at.x, box.left, box.right);
      if (intensity !== 0) panRef.current(intensity * MAX_PAN_FRACTION_PER_FRAME);
    }
    onFrame.current?.();

    frame.current = requestAnimationFrame(step);
  }, [scrollRef, trackRef]);

  const track = useCallback(
    (clientX: number, clientY: number): void => {
      pointer.current = { x: clientX, y: clientY };
      frame.current ??= requestAnimationFrame(step);
    },
    [step],
  );

  const setOnFrame = useCallback((callback: (() => void) | null): void => {
    onFrame.current = callback;
  }, []);

  // A drag that ends by unmounting (navigation, a filter change) must not leave a loop running.
  useEffect(() => stop, [stop]);

  return useMemo<TimelineAutoScroll>(
    () => ({ track, stop, setOnFrame }),
    [track, stop, setOnFrame],
  );
}
