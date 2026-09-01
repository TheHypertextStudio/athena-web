'use client';

/**
 * The team throughput chart: whether this team is keeping up.
 *
 * @remarks
 * Two cumulative lines over the rolling window — work still open, and work completed. The gap
 * between them is the backlog the team is carrying, and the shape of that gap is the answer:
 * narrowing means the team is closing faster than work arrives, widening means the opposite, and
 * parallel means it is holding steady. Reading the two lines separately would make that the
 * reader's arithmetic, so the gap itself is shaded.
 *
 * Dependency-free responsive SVG for the same reasons as {@link import('./capacity-chart')}.
 */
import type { TeamActivityOut } from '../../lib/contracts/team';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useId } from 'react';

/** The fixed coordinate space the SVG scales to its container. */
const WIDTH = 600;
const HEIGHT = 160;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const PAD_LEFT = 4;
const PAD_RIGHT = 4;

/** Props for {@link ThroughputChart}. */
export interface ThroughputChartProps {
  /** The rolling daily series, oldest first. */
  throughput: TeamActivityOut['throughput'];
  /** How many days the window spans, for the axis captions. */
  windowDays: number;
  /** Extra classes merged onto the wrapper. */
  className?: string;
}

/**
 * The throughput lines.
 *
 * @param props - The {@link ThroughputChartProps}.
 * @returns the rendered chart, or an application-owned sentence when there is nothing to draw.
 */
export function ThroughputChart({
  throughput,
  windowDays,
  className,
}: ThroughputChartProps): JSX.Element {
  const gradientId = useId();

  // Fewer than two points is a line with no direction. Saying so beats drawing a dot.
  if (throughput.length < 2) {
    return (
      <p className={cn('text-on-surface-variant text-body-medium', className)}>
        Not enough history yet to show a trend. This fills in as the team works.
      </p>
    );
  }

  const peak = Math.max(...throughput.map((p) => Math.max(p.pending, p.completed)), 1);
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xAt = (index: number): number => PAD_LEFT + (index / (throughput.length - 1)) * plotWidth;
  const yAt = (value: number): number => PAD_TOP + plotHeight - (value / peak) * plotHeight;

  const pendingPoints = throughput.map((p, i) => `${String(xAt(i))},${String(yAt(p.pending))}`);
  const completedPoints = throughput.map((p, i) => `${String(xAt(i))},${String(yAt(p.completed))}`);

  // The shaded band between the lines: down the pending line, back along the completed one.
  const bandPath = `M ${pendingPoints.join(' L ')} L ${[...completedPoints].reverse().join(' L ')} Z`;

  const first = throughput[0];
  const last = throughput[throughput.length - 1];

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* `preserveAspectRatio="none"` stretches the plot to the container instead of letterboxing
          it: uniform scaling left the series centred in dead space and looking like it stopped
          early. The strokes opt out of the resulting distortion with `vector-effect`, so the lines
          keep one weight at any container width. */}
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Open and completed work over the last ${String(windowDays)} days. Open went from ${String(first?.pending ?? 0)} to ${String(last?.pending ?? 0)}; completed went from ${String(first?.completed ?? 0)} to ${String(last?.completed ?? 0)}.`}
        className="h-40 w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              className="text-primary"
              stopColor="currentColor"
              stopOpacity="0.18"
            />
            <stop
              offset="100%"
              className="text-primary"
              stopColor="currentColor"
              stopOpacity="0.02"
            />
          </linearGradient>
        </defs>

        <path d={bandPath} fill={`url(#${gradientId})`} />

        <polyline
          points={completedPoints.join(' ')}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="text-state-completed"
          stroke="currentColor"
        />
        <polyline
          points={pendingPoints.join(' ')}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="text-primary"
          stroke="currentColor"
        />
      </svg>

      <div className="flex items-center justify-between gap-4">
        <ul className="flex list-none flex-wrap gap-x-5 gap-y-1.5">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="bg-primary h-0.5 w-4 shrink-0 rounded-full" />
            <span className="text-on-surface-variant text-label-small">Open</span>
            <span className="text-on-surface text-label-small tabular-nums">
              {last?.pending ?? 0}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="bg-state-completed h-0.5 w-4 shrink-0 rounded-full"
            />
            <span className="text-on-surface-variant text-label-small">Completed</span>
            <span className="text-on-surface text-label-small tabular-nums">
              {last?.completed ?? 0}
            </span>
          </li>
        </ul>
        <span className="text-on-surface-variant text-label-small shrink-0">
          Last {windowDays} days
        </span>
      </div>
    </div>
  );
}

export default ThroughputChart;
