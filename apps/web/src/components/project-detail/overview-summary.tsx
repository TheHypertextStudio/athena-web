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
 * - **By milestone** — each milestone (in display order, Unscheduled last) with its own
 *   done/total count and a thin completion bar, so a viewer sees which milestones are
 *   carrying the project and which are stalled — without leaving Overview for the Tasks tab.
 *
 * All counts use {@link stateTypeOf} for the canonical type and the shared state tokens for
 * color, so the breakdown stays consistent with the status glyphs everywhere else.
 */
import type { TaskOut } from '@docket/types';
import { cn } from '@docket/ui';
import { StatusIcon, type WorkflowStateType } from '@docket/ui/components';
import { Flag, ListChecks } from '@docket/ui/icons';
import type { JSX } from 'react';
import { useMemo } from 'react';

import { STATE_GROUP_LABEL, STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

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
  /** Ordered milestone metadata; an Unscheduled bucket is appended when needed. */
  milestones: readonly SummaryMilestone[];
  /** The (vocabulary-resolved) plural task noun, lowercased for inline copy. */
  taskNounPlural: string;
}

/** The `bg-state-*` token class for each canonical state type (segmented-bar fill). */
const STATE_BAR_CLASS: Record<WorkflowStateType, string> = {
  backlog: 'bg-state-backlog',
  unstarted: 'bg-state-unstarted',
  started: 'bg-state-started',
  completed: 'bg-state-completed',
  canceled: 'bg-state-canceled',
};

/** The synthesized Unscheduled bucket id. */
const UNSCHEDULED_ID = '__unscheduled__';

/** Whether a canonical state type counts as "done" for milestone completion. */
function isComplete(type: WorkflowStateType): boolean {
  return type === 'completed';
}

/**
 * The state-distribution + by-milestone breakdown card.
 *
 * @param props - The {@link OverviewSummaryProps}.
 * @returns the rendered summary, or an inviting empty state when there are no tasks.
 */
export function OverviewSummary({
  tasks,
  milestones,
  taskNounPlural,
}: OverviewSummaryProps): JSX.Element {
  const total = tasks.length;

  /** Count of tasks per canonical state type, in canonical order (zeros dropped for chips). */
  const byState = useMemo(() => {
    const counts = new Map<WorkflowStateType, number>();
    for (const t of tasks) {
      const type = stateTypeOf(t.task.state);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return STATE_GROUP_ORDER.map((type) => ({ type, count: counts.get(type) ?? 0 }));
  }, [tasks]);

  /** Per-milestone done/total roll-up, in display order with Unscheduled last. */
  const byMilestone = useMemo(() => {
    const order = new Map<string, number>();
    milestones.forEach((m, i) => order.set(m.id, i));
    const name = new Map<string, string>(milestones.map((m) => [m.id, m.name]));

    const buckets = new Map<string, { done: number; total: number }>();
    for (const t of tasks) {
      const key = t.milestoneId ?? UNSCHEDULED_ID;
      const bucket = buckets.get(key) ?? { done: 0, total: 0 };
      bucket.total += 1;
      if (isComplete(stateTypeOf(t.task.state))) bucket.done += 1;
      buckets.set(key, bucket);
    }

    return [...buckets.entries()]
      .map(([id, b]) => ({
        id,
        label: id === UNSCHEDULED_ID ? 'Unscheduled' : (name.get(id) ?? 'Milestone'),
        done: b.done,
        total: b.total,
        rank: id === UNSCHEDULED_ID ? milestones.length : (order.get(id) ?? milestones.length),
      }))
      .sort((a, b) => a.rank - b.rank);
  }, [tasks, milestones]);

  if (total === 0) {
    return (
      <section
        aria-label="Status breakdown"
        className="border-outline-variant bg-surface-container-low text-on-surface-variant text-body rounded-xl border p-4"
      >
        No {taskNounPlural} yet — add one from the Tasks tab to see the breakdown here.
      </section>
    );
  }

  return (
    <section
      aria-label="Status breakdown"
      className="border-outline-variant bg-surface-container-low flex flex-col gap-6 rounded-xl border p-4"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ListChecks aria-hidden="true" className="text-on-surface-variant size-4" />
          <h2 className="text-on-surface text-base font-semibold">Status</h2>
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
            .map((s) => `${s.count} ${STATE_GROUP_LABEL[s.type]}`)
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
              <li key={s.type} className="flex items-center gap-1.5 text-xs">
                <StatusIcon type={s.type} className="size-3.5" label={STATE_GROUP_LABEL[s.type]} />
                <span className="text-on-surface-variant">{STATE_GROUP_LABEL[s.type]}</span>
                <span className="text-on-surface font-medium tabular-nums">{s.count}</span>
              </li>
            ))}
        </ul>
      </div>

      <div className="border-outline-variant flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center gap-2">
          <Flag aria-hidden="true" className="text-on-surface-variant size-4" />
          <h2 className="text-on-surface text-base font-semibold">By milestone</h2>
        </div>

        <ul className="flex flex-col gap-3">
          {byMilestone.map((m) => {
            const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
            return (
              <li key={m.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-on-surface text-body truncate">{m.label}</span>
                  <span className="text-on-surface-variant shrink-0 text-xs tabular-nums">
                    {m.done}/{m.total}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${m.label}: ${pct}% complete`}
                  className="bg-surface-container h-1.5 w-full overflow-hidden rounded-full"
                >
                  <div
                    className="bg-state-completed h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
