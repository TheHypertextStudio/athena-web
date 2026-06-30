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
import { Stack } from '@docket/ui/primitives';
import { type JSX } from 'react';

import Link from 'next/link';

import { OrgChip } from '@/components/org-chip';

import { type CalendarBlock, selectNextUp } from './next-up-select';

/** Format an ISO timestamp as a local `h:mm AM/PM` clock label, e.g. `9:30 AM`. */
function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

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
          {picks.map((pick) => {
            const orgId =
              pick.kind === 'block' ? pick.block.organizationId : pick.task.organizationId;
            const taskId = pick.kind === 'block' ? pick.block.taskId : pick.task.id;
            const title = pick.kind === 'block' ? taskTitle(pick.block.taskId) : pick.task.title;
            const lead = pick.kind === 'block' ? formatClock(pick.block.startsAt) : 'Due today';
            return (
              <li key={`${pick.kind}-${taskId}-${pick.kind === 'block' ? pick.block.startsAt : ''}`}>
                <Link
                  href={`/orgs/${orgId}/tasks/${taskId}`}
                  className="border-outline-variant bg-surface-container-low hover:bg-surface-container focus-visible:ring-ring flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="text-on-surface-variant min-w-[5.5rem] shrink-0 text-sm tabular-nums">
                    {lead}
                  </span>
                  <span className="text-on-surface min-w-0 flex-1 truncate text-base font-medium">
                    {title}
                  </span>
                  <OrgChip orgId={orgId} name={orgName(orgId)} />
                </Link>
              </li>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
