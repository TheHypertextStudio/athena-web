'use client';

/**
 * The weighted-progress bar for the project-detail overview.
 *
 * @remarks
 * Renders the project's {@link ProjectProgress} roll-up: a token-colored bar that fills as
 * tasks complete, weighted by estimate (bigger tasks count for more) when estimates exist
 * and by plain count otherwise. The bar is exposed as a
 * `role="progressbar"` with `aria-valuenow/min/max` for assistive tech, and a compact
 * legend reports the completed/total counts and the percentage.
 */
import type { ProjectProgress } from '@docket/types';
import { CheckCircle2 } from '@docket/ui/icons';
import type { JSX } from 'react';

/** Props for {@link WeightedProgress}. */
export interface WeightedProgressProps {
  /** The weighted-progress roll-up from `GET …/projects/:id/progress`. */
  progress: ProjectProgress;
}

/**
 * The weighted-progress bar with a count + percentage legend.
 *
 * @param props - The {@link WeightedProgressProps}.
 * @returns the rendered progress block.
 */
export function WeightedProgress({ progress }: WeightedProgressProps): JSX.Element {
  const pct = Math.round(progress.percent * 100);
  const label = `${pct}% complete — ${progress.completedCount} of ${progress.taskCount} tasks done`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 aria-hidden="true" className="text-on-surface-variant size-4" />
          <span className="text-on-surface text-body-medium font-medium">Progress</span>
        </div>
        <span className="text-on-surface text-body-medium font-semibold tabular-nums">{pct}%</span>
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
          className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
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
