'use client';

/**
 * `timeline` — the viewport: the window of time on screen, and the actions that move it.
 *
 * @remarks
 * Held by the *page* rather than the canvas so that the axis controls can live in the page's one
 * toolbar row alongside the lens switcher and the filter controls. When the canvas owned this
 * state, its controls had to render inside the canvas, which forced a second control row directly
 * above the chart — on a phone that pushed the first bar below the fold. Lifting the state is what
 * lets every control collapse into a single row.
 *
 * The viewport is initialised once from the data and then belongs to the user. It is deliberately
 * *not* recomputed when rows change, so editing a date never yanks the view out from under someone
 * mid-edit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ViewScale } from '@/components/views/field-catalog';

import type { TimelineSpan } from './timeline-catalog';
import {
  type TimeScale,
  type TimeWindow,
  buildScale,
  defaultWindow,
  panWindow,
  windowForGranularity,
  zoomWindow,
} from './time-scale';

/** Zoom factor applied per step; `<1` zooms in. */
const ZOOM_STEP = 0.8;

/** The viewport plus the actions that move it. */
export interface TimelineViewport {
  /** The exact window on screen. */
  window: TimeWindow;
  /** The resolved scale (granularity + ticks) for the window. */
  scale: TimeScale;
  /** Replace the window (used by wheel zoom/pan inside the canvas). */
  setWindow: (next: TimeWindow | ((current: TimeWindow) => TimeWindow)) => void;
  /** Re-frame the viewport on the data and today. */
  resetToToday: () => void;
  /** Zoom in about the window's centre. */
  zoomIn: () => void;
  /** Zoom out about the window's centre. */
  zoomOut: () => void;
  /** Pan earlier by a quarter of the window. */
  panEarlier: () => void;
  /** Pan later by a quarter of the window. */
  panLater: () => void;
}

/**
 * Own a timeline's viewport.
 *
 * @param spans - The placed spans, used only to frame the initial window.
 * @param requested - The requested granularity from the display options.
 * @returns the {@link TimelineViewport}.
 */
export function useTimelineViewport(
  spans: readonly TimelineSpan[],
  requested: ViewScale,
): TimelineViewport {
  const [window, setWindow] = useState<TimeWindow>(() => defaultWindow(spans, Date.now()));
  const scale = useMemo(() => buildScale(window, requested), [requested, window]);

  /**
   * Establish the window: once from the data, and again whenever the granularity is *requested*.
   *
   * @remarks
   * Three moments, one rule — the window is (re)framed only when something the viewer did or the
   * data supplied genuinely changes what should be on screen:
   *
   * 1. **Mount.** The lazy initialiser above ran with `spans` still empty (the page's query is in
   *    flight), so it produced the no-data fallback. If the URL already asks for a granularity —
   *    the reload case — that request is applied here, which is what makes "Years" survive a
   *    reload as a *zoom* rather than as a relabelled 200-day window.
   * 2. **First data.** Re-frame on the real extents. Without this the timeline would keep the
   *    arbitrary fallback window forever and paint every bar off the right edge. One-shot: later
   *    data changes must not move the viewport, or editing a date would yank the view out from
   *    under the person editing it.
   * 3. **A changed request.** Choosing "Years" has to actually zoom out, or the five granularities
   *    are five spellings of one view. Keyed on the request alone, so a wheel zoom that happens to
   *    land in another granularity's territory never yanks the window. `'auto'` re-frames nothing
   *    — it is the absence of a request.
   */
  const framed = useRef(false);
  const lastRequest = useRef<ViewScale | null>(null);
  useEffect(() => {
    const firstData = !framed.current && spans.length > 0;
    const requestChanged = lastRequest.current !== null && lastRequest.current !== requested;
    if (lastRequest.current !== null && !firstData && !requestChanged) return;
    lastRequest.current = requested;
    if (firstData) framed.current = true;
    setWindow((current) =>
      windowForGranularity(firstData ? defaultWindow(spans, Date.now()) : current, requested),
    );
  }, [requested, spans]);

  const resetToToday = useCallback((): void => {
    setWindow(defaultWindow(spans, Date.now()));
  }, [spans]);

  const zoomIn = useCallback((): void => {
    setWindow((current) => zoomWindow(current, ZOOM_STEP, 0.5));
  }, []);
  const zoomOut = useCallback((): void => {
    setWindow((current) => zoomWindow(current, 1 / ZOOM_STEP, 0.5));
  }, []);
  const panEarlier = useCallback((): void => {
    setWindow((current) => panWindow(current, -0.25));
  }, []);
  const panLater = useCallback((): void => {
    setWindow((current) => panWindow(current, 0.25));
  }, []);

  return { window, scale, setWindow, resetToToday, zoomIn, zoomOut, panEarlier, panLater };
}
