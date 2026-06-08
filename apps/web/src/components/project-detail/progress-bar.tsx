'use client';

/**
 * The weighted-progress bar + health pill for the project-detail overview.
 *
 * @remarks
 * Renders the project's {@link ProjectProgress} roll-up: a token-colored bar that fills as
 * tasks complete, weighted by estimate (bigger tasks count for more) when estimates exist
 * and by plain count otherwise. The fill color tracks the project's {@link Health} so a
 * struggling project reads red even at high completion. The bar is exposed as a
 * `role="progressbar"` with `aria-valuenow/min/max` for assistive tech, and a compact
 * legend reports the completed/total counts and the percentage.
 */
import type { Health, ProjectProgress } from '@docket/types';
import { cn } from '@docket/ui';
import { CheckCircle2 } from '@docket/ui/icons';
import type { JSX } from 'react';

import { HEALTH_FILL_CLASS, HEALTH_LABEL, HEALTH_PILL_CLASS } from './health';

/** Props for {@link HealthPill}. */
export interface HealthPillProps {
  /** The health verdict, or `null` when unset. */
  health: Health | null;
}

/** A compact pill rendering the project's health verdict (or a neutral "No health"). */
export function HealthPill({ health }: HealthPillProps): JSX.Element {
  if (!health) {
    return (
      <span className="text-on-surface-variant bg-surface-container ring-outline-variant inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset">
        <span aria-hidden="true" className="bg-on-surface-variant/60 size-1.5 rounded-full" />
        No health set
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        HEALTH_PILL_CLASS[health],
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', HEALTH_FILL_CLASS[health])} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

/** Props for {@link WeightedProgress}. */
export interface WeightedProgressProps {
  /** The weighted-progress roll-up from `GET …/projects/:id/progress`. */
  progress: ProjectProgress;
  /** The project's health, used to color the fill. */
  health: Health | null;
}

/**
 * The weighted-progress bar with a count + percentage legend.
 *
 * @param props - The {@link WeightedProgressProps}.
 * @returns the rendered progress block.
 */
export function WeightedProgress({ progress, health }: WeightedProgressProps): JSX.Element {
  const pct = Math.round(progress.percent * 100);
  const fillClass = health ? HEALTH_FILL_CLASS[health] : 'bg-primary';
  const label = `${pct}% complete — ${progress.completedCount} of ${progress.taskCount} tasks done`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 aria-hidden="true" className="text-on-surface-variant size-4" />
          <span className="text-on-surface text-sm font-medium">Progress</span>
        </div>
        <span className="text-on-surface text-sm font-semibold tabular-nums">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="bg-surface-container h-2 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500 ease-out', fillClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-on-surface-variant text-xs tabular-nums">
        {progress.completedCount} of {progress.taskCount}{' '}
        {progress.taskCount === 1 ? 'task' : 'tasks'} complete
      </p>
    </div>
  );
}
