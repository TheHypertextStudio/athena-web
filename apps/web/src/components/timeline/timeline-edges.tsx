'use client';

/**
 * `timeline` — the dependency edge layer.
 *
 * @remarks
 * Dependency arrows are the reason a timeline beats a table. `blockedByIds`/`blocksIds` were
 * already on the wire and already surfaced as a count in the list lens; drawing them against the
 * time axis is what turns "3 upstream" into "and *this* one lands after you were supposed to
 * start."
 *
 * Three decisions keep the layer from becoming noise:
 *
 * - **Edges are drawn on demand.** Only the hovered row's relationships plus every currently
 *   violated edge are rendered. A portfolio with dense dependencies would otherwise reduce to a
 *   thicket the moment it loaded.
 * - **Violated edges are always visible**, in the destructive tone, whether or not anything is
 *   hovered — including violations that predate the session. A constraint breach is standing
 *   signal, not a hover reward.
 * - **Corners are rounded.** Hard right-angle elbows read as a wiring diagram rather than as part
 *   of a designed surface. Rounding them requires *pixel* coordinates: a percentage-based viewBox
 *   scales x and y by wildly different factors, so any curve drawn in those units comes out
 *   visibly skewed. The layer therefore measures the track once with a `ResizeObserver` and works
 *   in pixels. That is one observation for the whole layer — it does not reintroduce the per-row
 *   DOM measurement the layout model exists to avoid.
 */
import { cn } from '@docket/ui';
import { type JSX, type RefObject, useEffect, useState } from 'react';

import type { Violation } from './cascade';
import type { TimelineSpan } from './timeline-catalog';
import { type TimeWindow, pct } from './time-scale';

/** Everything the layer needs to route one edge's endpoints. */
export interface EdgeAnchor {
  /** The row's span. */
  readonly span: TimelineSpan;
  /** The row track's vertical center, in pixels from the top of the canvas. */
  readonly center: number;
}

/** Props for {@link TimelineEdges}. */
export interface TimelineEdgesProps {
  /** The edges to consider, as `blocker → blocked` id pairs. */
  edges: readonly Violation[];
  /** Per-row routing anchors, keyed by row id. */
  anchors: ReadonlyMap<string, EdgeAnchor>;
  /** The violated subset, so those edges render in the destructive tone and always show. */
  violations: ReadonlySet<string>;
  /** The hovered row id, whose relationships are revealed, or `null`. */
  hoveredId: string | null;
  /** The viewport, for projecting endpoints. */
  window: TimeWindow;
  /** The canvas height in pixels. */
  height: number;
  /** The plot area, measured to convert window percentages into pixels. */
  trackRef: RefObject<HTMLElement | null>;
}

/** A stable key for a `blocker → blocked` pair. */
export function edgeKey(blockerId: string, blockedId: string): string {
  return `${blockerId}→${blockedId}`;
}

/** How far an edge juts horizontally out of a bar before turning, in pixels. */
const ELBOW = 14;
/** The corner radius of each elbow, in pixels. */
const RADIUS = 7;

/**
 * Build a rounded orthogonal path through the given waypoints.
 *
 * @remarks
 * Emits a line to just before each corner, a quadratic curve *through* the corner, then continues.
 * The radius is clamped to half the shorter adjacent segment so a tight elbow degrades to a
 * smaller curve rather than overshooting into a loop.
 *
 * @param points - The orthogonal waypoints, in pixels.
 * @returns the SVG path `d` attribute.
 */
function roundedPath(points: readonly (readonly [number, number])[]): string {
  if (points.length < 2) return '';
  const [first] = points;
  if (!first) return '';
  let d = `M ${first[0]} ${first[1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    if (!previous || !corner || !next) continue;
    const inLength = Math.hypot(corner[0] - previous[0], corner[1] - previous[1]);
    const outLength = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
    const r = Math.min(RADIUS, inLength / 2, outLength / 2);
    if (r < 0.5) {
      d += ` L ${corner[0]} ${corner[1]}`;
      continue;
    }
    const enterX = corner[0] + ((previous[0] - corner[0]) / inLength) * r;
    const enterY = corner[1] + ((previous[1] - corner[1]) / inLength) * r;
    const exitX = corner[0] + ((next[0] - corner[0]) / outLength) * r;
    const exitY = corner[1] + ((next[1] - corner[1]) / outLength) * r;
    d += ` L ${enterX} ${enterY} Q ${corner[0]} ${corner[1]} ${exitX} ${exitY}`;
  }
  const last = points[points.length - 1];
  if (last) d += ` L ${last[0]} ${last[1]}`;
  return d;
}

/**
 * Render the dependency edges as an overlaid SVG layer.
 *
 * @param props - The {@link TimelineEdgesProps}.
 * @returns the rendered edge layer.
 */
export default function TimelineEdges({
  edges,
  anchors,
  violations,
  hoveredId,
  window,
  height,
  trackRef,
}: TimelineEdgesProps): JSX.Element | null {
  const [width, setWidth] = useState(0);

  // One observation for the whole layer, so percentage offsets can become pixels.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(track);
    setWidth(track.getBoundingClientRect().width);
    return () => {
      observer.disconnect();
    };
  }, [trackRef]);

  if (width <= 0) return null;

  const visible = edges.filter((edge) => {
    const key = edgeKey(edge.blockerId, edge.blockedId);
    if (violations.has(key)) return true;
    return hoveredId === edge.blockerId || hoveredId === edge.blockedId;
  });

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[4]"
      width={width}
      height={height}
    >
      {visible.map((edge) => {
        const from = anchors.get(edge.blockerId);
        const to = anchors.get(edge.blockedId);
        if (!from || !to) return null;
        const key = edgeKey(edge.blockerId, edge.blockedId);
        const violated = violations.has(key);
        const x1 = (pct(from.span.end, window) / 100) * width;
        const x2 = (pct(to.span.start, window) / 100) * width;
        // Leave the blocker's trailing edge, run the long horizontal segment along the boundary
        // *between* the two rows, then approach the blocked bar's leading edge from outside. A
        // single-elbow route travels at the destination row's centre, drawing the line straight
        // through that bar so it reads as a strikethrough through its label.
        const lane = (from.center + to.center) / 2;
        const d = roundedPath([
          [x1, from.center],
          [x1 + ELBOW, from.center],
          [x1 + ELBOW, lane],
          [x2 - ELBOW, lane],
          [x2 - ELBOW, to.center],
          [x2, to.center],
        ]);
        return (
          <path
            key={key}
            d={d}
            className={cn('fill-none', violated ? 'stroke-error/70' : 'stroke-outline')}
            strokeWidth={violated ? 1.75 : 1.25}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}
