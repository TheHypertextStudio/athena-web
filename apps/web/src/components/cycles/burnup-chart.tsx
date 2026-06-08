'use client';

/**
 * The cycle burn-up line chart.
 *
 * @remarks
 * Answers a cycle's headline question — "are we on pace?" — by drawing, over the cycle's
 * calendar window, two cumulative lines from the {@link import('@docket/types').CycleBurnupOut | burn-up report}:
 *
 * - **Planned** — cumulative committed capacity known by each day. It steps *up* whenever
 *   scope is added mid-cycle, so a rising plan line reads as scope creep at a glance.
 * - **Completed** — cumulative effort whose `completedAt` lands on or before each day. When
 *   it climbs to meet the plan line, the cycle is done.
 *
 * The gap between the two is the remaining work, shaded so the "distance to plan" is the
 * visible quantity. A vertical "today" marker shows where the window currently sits, so a
 * completed line trailing far below the plan with little runway left reads as off-pace.
 *
 * It is a dependency-free, responsive SVG (no chart library): the viewBox is a fixed
 * coordinate space the SVG scales to its container, and every color comes from semantic
 * design tokens via `currentColor`/token utility classes — never hardcoded. A screen-reader
 * summary describes the trend for assistive tech.
 */
import type { CycleBurnupOut } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useId, useMemo } from 'react';

import type { WindowProgress } from './format-window';

/** Props for {@link BurnupChart}. */
export interface BurnupChartProps {
  /** The cycle's daily burn-up series and totals. */
  burnup: CycleBurnupOut;
  /** The window's live progress (drives the "today" marker). */
  window: WindowProgress;
  /** Extra classes merged onto the chart wrapper. */
  className?: string;
}

/** The fixed SVG coordinate space the chart is drawn in, then scaled to its container. */
const VIEW_W = 720;
const VIEW_H = 220;
/** Inner plot padding (room for the baseline + the top capacity line). */
const PAD_X = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 8;

/** A point in the SVG coordinate space. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** Project a daily-value series into SVG coordinates, scaled so `maxY` reaches the plot top. */
function toCoords(values: readonly number[], maxY: number): Point[] {
  const plotW = VIEW_W - PAD_X * 2;
  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const lastIndex = Math.max(1, values.length - 1);
  return values.map((value, index) => ({
    x: PAD_X + (index / lastIndex) * plotW,
    y: PAD_TOP + plotH * (1 - (maxY === 0 ? 0 : value / maxY)),
  }));
}

/** Render a coordinate list as a polyline `points` attribute string. */
function polyline(points: readonly Point[]): string {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

/**
 * The burn-up line chart for a cycle's stats banner.
 *
 * @example
 * ```tsx
 * <BurnupChart burnup={burnup} window={windowProgress(cy.startsAt, cy.endsAt)} />
 * ```
 */
export function BurnupChart({ burnup, window, className }: BurnupChartProps): JSX.Element {
  const titleId = useId();
  const descId = useId();

  const { plannedPoints, completedPoints, areaPath, maxY, todayX } = useMemo(() => {
    const series = burnup.series;
    const planned = series.map((point) => point.planned);
    const completed = series.map((point) => point.completed);
    // The y-axis tops out at the largest planned value (capacity always >= completed), with a
    // floor of 1 so an all-zero (unestimated) cycle still renders a flat baseline rather than
    // dividing by zero.
    const peak = Math.max(1, ...planned);

    const plannedCoords = toCoords(planned, peak);
    const completedCoords = toCoords(completed, peak);

    // The remaining-work band is the closed region between the two lines: trace the planned
    // line forward, then the completed line back to the start, and close.
    const forward = plannedCoords.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`);
    const back = [...completedCoords]
      .reverse()
      .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`);
    const area = `M${[...forward, ...back].join(' L')} Z`;

    const plotW = VIEW_W - PAD_X * 2;
    return {
      plannedPoints: polyline(plannedCoords),
      completedPoints: polyline(completedCoords),
      areaPath: area,
      maxY: peak,
      todayX: PAD_X + window.fraction * plotW,
    };
  }, [burnup.series, window.fraction]);

  const { stats } = burnup;
  const pacePct =
    stats.capacity === 0 ? 0 : Math.round((stats.completedCapacity / stats.capacity) * 100);

  const summary = `Burn-up over ${String(burnup.series.length)} days: ${String(
    stats.completedCapacity,
  )} of ${String(stats.capacity)} planned points complete (${String(pacePct)}%), with ${String(
    stats.carryover,
  )} ${stats.carryover === 1 ? 'task' : 'tasks'} still open.`;

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <svg
        viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="h-40 w-full"
      >
        <title id={titleId}>Cycle burn-up</title>
        <desc id={descId}>{summary}</desc>

        {/* Baseline. */}
        <line
          x1={PAD_X}
          y1={VIEW_H - PAD_BOTTOM}
          x2={VIEW_W - PAD_X}
          y2={VIEW_H - PAD_BOTTOM}
          className="text-border"
          stroke="currentColor"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        {/* Remaining-work band: the gap between planned and completed. */}
        <path d={areaPath} className="text-on-surface-variant/15" fill="currentColor" />

        {/* "Today" marker — where the window currently sits. */}
        {!window.ended ? (
          <line
            x1={todayX}
            y1={PAD_TOP}
            x2={todayX}
            y2={VIEW_H - PAD_BOTTOM}
            className="text-primary/50"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {/* Planned (capacity) line. */}
        <polyline
          points={plannedPoints}
          fill="none"
          className="text-on-surface-variant"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Completed line — the headline trend. */}
        <polyline
          points={completedPoints}
          fill="none"
          className="text-state-started"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <figcaption className="text-on-surface-variant flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="bg-state-started h-0.5 w-4 rounded-full" />
          Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="bg-on-surface-variant h-0.5 w-4 rounded-full" />
          Planned capacity
        </span>
        <span className="text-on-surface-variant tabular-nums">
          peak {maxY} {maxY === 1 ? 'point' : 'points'}
        </span>
      </figcaption>
    </figure>
  );
}
