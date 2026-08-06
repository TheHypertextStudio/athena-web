'use client';

/**
 * The team capacity chart: what this team is holding right now.
 *
 * @remarks
 * Answers the question a team page exists to answer — "how loaded is this team" — by drawing the
 * open work as one horizontal bar split by canonical workflow-state type. Backlog against work in
 * progress is the comparison that matters: a long backlog next to a short in-progress segment is a
 * team with room, and the reverse is a team at its limit.
 *
 * One stacked bar rather than three separate ones, because the quantity a reader wants is the
 * *proportion*. Three bars would show three numbers and make the ratio something to compute.
 *
 * Dependency-free responsive SVG, the same choice {@link import('../cycles/burnup-chart')} made: a
 * fixed viewBox the browser scales to the container, every color from a semantic design token, and
 * a screen-reader summary carrying the same information the picture does.
 */
import type { TeamActivityOut, WorkflowStateType } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

/** How each open bucket is labelled and painted. */
const BUCKET_STYLE: Record<
  Extract<WorkflowStateType, 'backlog' | 'unstarted' | 'started'>,
  { label: string; fill: string; swatch: string }
> = {
  backlog: {
    label: 'Backlog',
    fill: 'fill-surface-container-highest',
    swatch: 'bg-surface-container-highest',
  },
  unstarted: { label: 'Ready', fill: 'fill-primary/40', swatch: 'bg-primary/40' },
  started: { label: 'In progress', fill: 'fill-primary', swatch: 'bg-primary' },
};

/** The buckets, in the order work moves through them. */
const BUCKET_ORDER = ['backlog', 'unstarted', 'started'] as const;

/** Props for {@link CapacityChart}. */
export interface CapacityChartProps {
  /** The team's capacity snapshot. */
  capacity: TeamActivityOut['capacity'];
  /** Whether to weight by estimate points instead of counting tasks. */
  weightByEstimate: boolean;
  /** Extra classes merged onto the wrapper. */
  className?: string;
}

/** The bar's fixed coordinate space, scaled to the container by the viewBox. */
const WIDTH = 600;
const HEIGHT = 44;

/**
 * The capacity bar.
 *
 * @param props - The {@link CapacityChartProps}.
 * @returns the rendered chart, or an application-owned sentence when there is nothing to draw.
 */
export function CapacityChart({
  capacity,
  weightByEstimate,
  className,
}: CapacityChartProps): JSX.Element {
  const valueOf = (type: (typeof BUCKET_ORDER)[number]): number => {
    const bucket = capacity.find((entry) => entry.type === type);
    if (!bucket) return 0;
    return weightByEstimate ? bucket.estimate : bucket.taskCount;
  };

  const values = BUCKET_ORDER.map((type) => ({ type, value: valueOf(type) }));
  const total = values.reduce((sum, entry) => sum + entry.value, 0);

  // A team with no open work has no proportion to show. An empty bar would read as a rendering
  // failure, so it is replaced by a sentence saying what would fill it.
  if (total === 0) {
    return (
      <p className={cn('text-on-surface-variant text-sm', className)}>
        {weightByEstimate
          ? 'No estimated work is open on this team. Estimate some open tasks to see capacity by points.'
          : 'No open work on this team right now.'}
      </p>
    );
  }

  let offset = 0;
  const segments = values
    .filter((entry) => entry.value > 0)
    .map((entry) => {
      const width = (entry.value / total) * WIDTH;
      const segment = { ...entry, x: offset, width };
      offset += width;
      return segment;
    });

  const unit = weightByEstimate ? 'points' : 'tasks';
  const summary = values
    .map((entry) => `${String(entry.value)} ${BUCKET_STYLE[entry.type].label.toLowerCase()}`)
    .join(', ');

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Open work by state, in ${unit}: ${summary}.`}
        className="h-11 w-full"
      >
        {segments.map((segment) => (
          <rect
            key={segment.type}
            x={segment.x}
            y={0}
            width={Math.max(segment.width - 2, 1)}
            height={HEIGHT}
            rx={4}
            className={BUCKET_STYLE[segment.type].fill}
          />
        ))}
      </svg>

      <ul className="flex list-none flex-wrap gap-x-5 gap-y-1.5">
        {values.map((entry) => (
          <li key={entry.type} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn('size-2.5 shrink-0 rounded-sm', BUCKET_STYLE[entry.type].swatch)}
            />
            <span className="text-on-surface-variant text-xs">
              {BUCKET_STYLE[entry.type].label}
            </span>
            <span className="text-on-surface text-xs font-medium tabular-nums">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CapacityChart;
