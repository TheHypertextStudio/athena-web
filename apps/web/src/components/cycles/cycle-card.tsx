'use client';

/**
 * One cycle card in the Cycles list.
 *
 * @remarks
 * A cycle's at-a-glance summary on the list screen: its number + optional name (leading),
 * its date window, a status badge, and — once its rolled-up stats have loaded — a compact
 * pace strip (a capacity progress bar plus the committed/completed count and carryover).
 * Active cycles also show a thin time-elapsed marker so "how much runway is left" reads
 * without opening the cycle. The whole card is a link to the cycle detail with a focus ring
 * and hover affordance; before stats arrive a slim skeleton stands in for the pace strip so
 * the card never jumps.
 *
 * Rendered with `@docket/ui` primitives and semantic tokens — no hardcoded color.
 */
import type { CycleOut, CycleStats } from '@docket/types';
import { Badge, Skeleton } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import Link from 'next/link';
import type { JSX } from 'react';

import { formatWindow, windowProgress } from './format-window';
import { STATUS_LABEL, statusBadgeVariant } from './cycle-status';

/** Props for {@link CycleCard}. */
export interface CycleCardProps {
  /** The cycle to summarize. */
  cycle: CycleOut;
  /** The cycle's rolled-up stats, or `null` while they load (or if they failed). */
  stats: CycleStats | null;
  /** The (vocabulary-resolved) singular cycle noun (e.g. "Cycle", "Sprint"). */
  cycleNoun: string;
  /** Href to the cycle's detail screen. */
  href: string;
}

/**
 * A single cycle summary card linking to its detail.
 *
 * @example
 * ```tsx
 * <CycleCard cycle={cycle} stats={stats} cycleNoun="Cycle" href={`/orgs/${orgId}/cycles/${cycle.id}`} />
 * ```
 */
export function CycleCard({ cycle, stats, cycleNoun, href }: CycleCardProps): JSX.Element {
  const title = cycle.name ?? `${cycleNoun} ${String(cycle.number)}`;
  const pacePct =
    stats && stats.capacity > 0 ? Math.round((stats.completedCapacity / stats.capacity) * 100) : 0;
  const taskPct =
    stats && stats.committed > 0 ? Math.round((stats.completed / stats.committed) * 100) : 0;
  const win = windowProgress(cycle.startsAt, cycle.endsAt);
  const isActive = cycle.status === 'active';

  return (
    <Link
      href={href}
      className={cn(
        'group border-outline-variant bg-surface-container-low focus-visible:ring-ring block rounded-xl border p-4 outline-none',
        'hover:bg-surface-container-high transition-colors focus-visible:ring-1',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="text-foreground truncate text-sm font-semibold">{title}</span>
            {cycle.name ? (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {cycleNoun} {cycle.number}
              </span>
            ) : null}
          </span>
          <span className="text-muted-foreground text-xs">
            {formatWindow(cycle.startsAt, cycle.endsAt)}
          </span>
        </div>
        <Badge variant={statusBadgeVariant(cycle.status)} className="shrink-0">
          {STATUS_LABEL[cycle.status]}
        </Badge>
      </div>

      {/* Pace strip — capacity progress + counts. */}
      <div className="mt-4 flex flex-col gap-2">
        {stats ? (
          <>
            <div
              className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pacePct}
              aria-label={`${cycleNoun} ${cycle.number} capacity complete`}
            >
              <span
                className="bg-state-started absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${String(Math.min(100, pacePct))}%` }}
              />
              {/* Time-elapsed tick for a live cycle: how far through the window we are. */}
              {isActive && !win.ended ? (
                <span
                  aria-hidden="true"
                  className="bg-primary/60 absolute inset-y-0 w-px"
                  style={{ left: `${String(Math.min(100, win.fraction * 100))}%` }}
                />
              ) : null}
            </div>
            <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs tabular-nums">
              <span>
                <span className="text-foreground font-medium">{stats.completed}</span>/
                {stats.committed} tasks · {taskPct}%
              </span>
              {stats.carryover > 0 && cycle.status !== 'completed' ? (
                <span className="text-state-started font-medium">{stats.carryover} open</span>
              ) : (
                <span>
                  {stats.completedCapacity}/{stats.capacity} pts
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-3 w-32" />
          </>
        )}
      </div>
    </Link>
  );
}
