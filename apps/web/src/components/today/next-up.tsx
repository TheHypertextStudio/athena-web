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
 */
import type { HubTaskItem } from '@docket/types';
import { ArrowRight } from '@docket/ui/icons';
import { Stack } from '@docket/ui/primitives';
import { type JSX } from 'react';

import Link from 'next/link';

import { OrgChip } from '@/components/org-chip';
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
}

/** The "Next up" section: the next few timeboxed blocks, or tasks due today, or a clear-day note. */
export default function NextUp({
  blocks,
  dueToday,
  taskTitle,
  orgName,
  now,
}: NextUpProps): JSX.Element {
  const picks = selectNextUp(blocks, dueToday, now ?? new Date());

  return (
    <Stack as="section" gap={4} aria-labelledby="today-next-up-heading">
      <h2 id="today-next-up-heading" className="text-on-surface text-lg font-semibold">
        Next up
      </h2>

      {picks.length === 0 ? (
        <Stack
          align="center"
          gap={2}
          className="border-outline-variant bg-surface-container-low/60 justify-center rounded-2xl border p-12 text-center"
        >
          <p className="text-on-surface text-lg font-medium">Nothing scheduled</p>
          <p className="text-on-surface-variant max-w-sm text-sm">
            You&apos;re clear for now. Capture a thought above, or timebox work onto your calendar.
          </p>
        </Stack>
      ) : (
        <Stack as="ul" gap={2}>
          {picks.map((pick, i) => {
            const orgId =
              pick.kind === 'block' ? pick.block.organizationId : pick.task.organizationId;
            const taskId = pick.kind === 'block' ? pick.block.taskId : pick.task.id;
            const title = pick.kind === 'block' ? taskTitle(pick.block.taskId) : pick.task.title;
            const lead = pick.kind === 'block' ? formatClock(pick.block.startsAt) : 'Due today';
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
                  className="group border-outline-variant bg-surface-container-low hover:bg-surface-container hover:border-outline focus-visible:ring-ring flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-[background-color,border-color,box-shadow,transform] duration-(--dur-base) ease-(--ease-out) hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none active:scale-[0.99] motion-safe:hover:-translate-y-px"
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
