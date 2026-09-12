'use client';

/**
 * The Overview status breakdown — a state-distribution bar and a by-milestone progress
 * roll-up that make the project's shape legible at a glance.
 *
 * @remarks
 * The project Overview previously leaned on a single weighted-progress bar plus a comment
 * composer, leaving the tab near-empty and giving no sense of *where* the work sits. This
 * component fills that gap with two compact, scannable summaries computed from the SAME task
 * list the Tasks tab renders — so the headline "{done} of {total}" count is identical
 * across the screen (no split-brain between the tab badge and the progress denominator):
 *
 * - **State distribution** — a segmented bar (one slice per canonical workflow-state type,
 *   colored by the shared `--color-state-*` tokens) over a chip legend (a {@link StatusIcon}
 *   + count per non-empty state). It answers "how much is in flight vs done vs not started".
 * The per-milestone breakdown that used to sit here is gone: the Milestones section directly below
 * renders the same done/total and completion bar per milestone, and does it on rows you can open.
 * Two lists of the same three numbers, stacked, is not a summary.
 *
 * All counts group by status category and use the shared state tokens for
 * color, so the breakdown stays consistent with the status glyphs everywhere else.
 */
import type { TaskOut } from '@docket/work/task-model';
import { cn } from '@docket/ui';
import { StatusIcon, type WorkflowStateType } from '@docket/ui/components';
import { ListChecks } from '@docket/ui/icons';
import { DecorativeIcon } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useMemo } from 'react';

import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { CATEGORY_LABEL, CATEGORY_ORDER } from '@/lib/work-category';

/** A task paired with its resolved milestone id (mirrors the Tasks-tab shape). */
export interface SummaryTask {
  /** The task DTO. */
  readonly task: TaskOut;
  /** The task's milestone id, or `null` when unscheduled. */
  readonly milestoneId: string | null;
}

/** Minimal milestone metadata for the by-milestone roll-up, in display order. */
export interface SummaryMilestone {
  /** The milestone id. */
  readonly id: string;
  /** The milestone name. */
  readonly name: string;
}

/** Props for {@link OverviewSummary}. */
export interface OverviewSummaryProps {
  /** The project's tasks, each with its resolved milestone (the canonical task set). */
  tasks: readonly SummaryTask[];
}

/** The `bg-state-*` token class for each canonical state type (segmented-bar fill). */
const STATE_BAR_CLASS: Record<WorkflowStateType, string> = {
  backlog: 'bg-state-backlog',
  unstarted: 'bg-state-unstarted',
  started: 'bg-state-started',
  completed: 'bg-state-completed',
  canceled: 'bg-state-canceled',
};

/**
 * The state-distribution card.
 *
 * @param props - The {@link OverviewSummaryProps}.
 * @returns the rendered summary, or an inviting empty state when there are no tasks.
 */
export function OverviewSummary({ tasks }: OverviewSummaryProps): JSX.Element {
  const total = tasks.length;
  const categoryOf = useCategoryOf('task');

  // Counted by category rather than by status name: the bar and its legend are a shape-of-the-work
  // read, and a workspace with three in-progress statuses still wants one in-progress band.
  const byState = useMemo(() => {
    const counts = new Map<WorkflowStateType, number>();
    for (const t of tasks) {
      const type = categoryOf(t.task.state);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return CATEGORY_ORDER.map((type) => ({ type, count: counts.get(type) ?? 0 }));
  }, [tasks, categoryOf]);

  return (
    <section
      aria-label="Status breakdown"
      className="border-outline-variant bg-surface-container-low flex flex-col gap-6 rounded-xl border p-4"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <DecorativeIcon icon={ListChecks} />
          <h2 className="text-on-surface text-title-medium">Status</h2>
        </div>

        {/* Distribution bar: one rounded slice per non-empty state type, widths proportional to
            count, paired with the chip legend below. It is deliberately styled to read as a
            categorical *breakdown* — not the weighted-progress bar above it: the slices are thinner
            (h-1.5 vs the progress bar's h-2), gapped, individually rounded, and softened to 90%
            opacity. That keeps a single-state project (e.g. all Backlog) from reading as a crisp
            100%-complete fill sitting under the empty 0% Progress bar; the legend names the
            state. */}
        <div
          className="flex h-1.5 w-full items-stretch gap-0.5"
          role="img"
          aria-label={byState
            .filter((s) => s.count > 0)
            .map((s) => `${s.count} ${CATEGORY_LABEL[s.type]}`)
            .join(', ')}
        >
          {byState
            .filter((s) => s.count > 0)
            .map((s) => (
              <div
                key={s.type}
                className={cn('rounded-full opacity-90', STATE_BAR_CLASS[s.type])}
                style={{ width: `${(s.count / total) * 100}%` }}
              />
            ))}
        </div>

        {/* Chip legend: status glyph + label + count for every state that has tasks. */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {byState
            .filter((s) => s.count > 0)
            .map((s) => (
              <li key={s.type} className="text-body-small flex items-center gap-1.5">
                <StatusIcon type={s.type} className="size-4" label={CATEGORY_LABEL[s.type]} />
                <span className="text-on-surface-variant">{CATEGORY_LABEL[s.type]}</span>
                <span className="text-on-surface text-label-medium tabular-nums">{s.count}</span>
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}
