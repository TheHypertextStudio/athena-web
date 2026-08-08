'use client';

/**
 * `today/next-up` — the calm "what's next today" list on the Today surface.
 *
 * @remarks
 * Surfaces the next few things the caller has coming up, in time order. It prefers today's
 * **timeboxed calendar blocks** (the daily-plan items with a window): any block still in the future
 * (or in progress), nearest-first. When nothing is timeboxed it falls back to **tasks due today** —
 * shown without a clock. When neither exists the day is clear, so it shows a quiet empty state
 * rather than an empty heading.
 *
 * The selection rule lives in the pure `selectNextUp` (in `./next-up-select`) so it can be
 * unit-tested against fixed timestamps without rendering.
 *
 * The section also owns its own **loading** state (SCR-01/SCR-02). It previously did not: the Today
 * page swapped the whole section out for a four-bar skeleton while the Hub read was in flight, and
 * the first of those bars stood where the literal heading "Next up" belongs. A grey bar over a
 * compile-time constant is a loading animation over data that is known ahead of time, so the
 * heading now paints unconditionally and only the rows beneath it — genuinely unknown until the
 * fetch resolves — carry a placeholder.
 */
import type { HubTaskItem } from '@docket/types';
import { cn } from '@docket/ui';
import { ArrowRight } from '@docket/ui/icons';
import { dragSourceProps } from '@docket/ui/lib/draggable';
import { Skeleton, Stack } from '@docket/ui/primitives';
import { type JSX } from 'react';

import Link from 'next/link';

import { OrgChip } from '@/components/org-chip';
import { entityDragSource } from '@/lib/entity-drag';
import { formatClock } from '@/lib/format-time';

import { type CalendarBlock, selectNextUp } from './next-up-select';

/** Props for {@link NextUp}. */
export interface NextUpProps {
  /** The day's timeboxed blocks (Hub `today.calendar`). */
  blocks: readonly CalendarBlock[];
  /** Tasks due today, the fallback when nothing is timeboxed (Hub `needsAttention.dueToday`). */
  dueToday: readonly HubTaskItem[];
  /** Resolve a task's title by id (from the plan), for a block's label. */
  taskTitle: (taskId: string) => string;
  /** Resolve an org's display name by id, for the row's org chip. */
  orgName: (orgId: string) => string;
  /** Reference instant for "upcoming"; defaults to now. Injectable for tests. */
  now?: Date;
  /**
   * Whether the day's blocks and due tasks are still being fetched.
   *
   * @remarks
   * The section owns its own loading treatment rather than being swapped out for one by its parent.
   * "Next up" is a compile-time constant, so a grey bar over it is strictly less information than
   * the word itself; only the rows below — the actual unknown-until-fetch content — get a
   * placeholder. See {@link NextUpRowsPlaceholder}.
   */
  loading?: boolean;
}

/**
 * The row-shaped stand-in shown beneath the heading while the day's items load.
 *
 * @returns Three row-height blocks matching the settled list's rhythm.
 */
function NextUpRowsPlaceholder(): JSX.Element {
  // placeholder: the day's next few timeboxed blocks (or tasks due today) — their count, titles,
  // start times and owning workspace are all unknown until the Hub read resolves.
  return (
    <Stack gap={2} aria-hidden="true">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </Stack>
  );
}

/** The "Next up" section: the next few timeboxed blocks, or tasks due today, or a clear-day note. */
export default function NextUp({
  blocks,
  dueToday,
  taskTitle,
  orgName,
  now,
  loading = false,
}: NextUpProps): JSX.Element {
  const picks = selectNextUp(blocks, dueToday, now ?? new Date());

  return (
    <Stack as="section" gap={4} aria-labelledby="today-next-up-heading">
      <h2 id="today-next-up-heading" className="text-on-surface text-lg font-semibold">
        Next up
      </h2>

      {loading ? (
        <NextUpRowsPlaceholder />
      ) : picks.length === 0 ? (
        // One quiet line, not a 12-unit bordered box around a reassurance and two instructions.
        // "You're clear for now. Capture a thought above, or timebox work onto your calendar."
        // told the reader how they should feel and then pointed at two controls already on screen.
        // An empty day is not an error state and does not need consoling or a diagram.
        <p className="text-on-surface-variant text-body-medium">Nothing scheduled.</p>
      ) : (
        <Stack as="ul" gap={2}>
          {picks.map((pick, i) => {
            const orgId =
              pick.kind === 'block' ? pick.block.organizationId : pick.task.organizationId;
            const taskId = pick.kind === 'block' ? pick.block.taskId : pick.task.id;
            const title = pick.kind === 'block' ? taskTitle(pick.block.taskId) : pick.task.title;
            const lead = pick.kind === 'block' ? formatClock(pick.block.startsAt) : 'Due today';
            // Both pick shapes resolve to the task behind the row, so a Next-up row drags as the
            // same canonical task object every other task surface publishes.
            const dragProps = dragSourceProps(
              entityDragSource({ kind: 'task', id: taskId, organizationId: orgId, title }),
            );
            return (
              <li
                key={`${pick.kind}-${taskId}-${pick.kind === 'block' ? pick.block.startsAt : ''}`}
                // Staggered reveal: each row eases up in turn (fill-mode-both holds it hidden
                // through its delay so it never flashes in early).
                className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both motion-safe:duration-500"
                style={{ animationDelay: `${String(i * 70)}ms` }}
              >
                <Link
                  href={`/orgs/${orgId}/tasks/${taskId}`}
                  {...dragProps}
                  className={cn(
                    'group border-outline-variant bg-surface-container-low hover:bg-surface-container active:bg-surface-container-high hover:border-outline focus-visible:ring-ring flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-[background-color,border-color,box-shadow,transform] duration-(--dur-base) ease-(--ease-out) hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none motion-safe:hover:-translate-y-px',
                    dragProps?.className,
                  )}
                >
                  <span className="text-on-surface-variant min-w-[5.5rem] shrink-0 text-sm tabular-nums">
                    {lead}
                  </span>
                  <span className="text-on-surface min-w-0 flex-1 truncate text-base font-medium">
                    {title}
                  </span>
                  <OrgChip orgId={orgId} name={orgName(orgId)} />
                  <ArrowRight className="text-on-surface-variant size-4 shrink-0 -translate-x-1 opacity-0 transition-[opacity,transform] duration-(--dur-base) ease-(--ease-out) group-hover:translate-x-0 group-hover:opacity-100" />
                </Link>
              </li>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
