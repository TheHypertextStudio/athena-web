'use client';

/**
 * One cycle row in the Cycles list.
 *
 * @remarks
 * A cycle's at-a-glance summary as a dense {@link EntityListRow} (design-system §5.1): a
 * leading status glyph, the cycle's number + optional name as the title, its date window as
 * the subtitle, and — once its rolled-up stats have loaded — a {@link RowProgress} pace bar
 * with its completed/committed count in the meta band, plus the status {@link Badge} trailing.
 * Before stats arrive a slim skeleton stands in for the pace meta so the row never jumps. The
 * whole row is a link to the cycle detail (rendered via a Next.js {@link Link} so the router
 * prefetches and Enter navigates natively).
 *
 * Rendered with `@docket/ui` primitives and semantic tokens — no hardcoded color.
 */
import type { CycleOut, CycleStats } from '@docket/types';
import { EntityListRow, RowMeta, RowProgress, StatusIcon } from '@docket/ui/components';
import { Badge, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { formatWindow } from './format-window';
import { STATUS_LABEL, statusBadgeVariant, statusGlyphType } from './cycle-status';

/** Props for {@link CycleRow}. */
export interface CycleRowProps {
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
 * A single cycle summary row linking to its detail.
 *
 * @example
 * ```tsx
 * <CycleRow cycle={cycle} stats={stats} cycleNoun="Cycle" href={`/orgs/${orgId}/cycles/${cycle.id}`} />
 * ```
 */
export function CycleRow({ cycle, stats, cycleNoun, href }: CycleRowProps): JSX.Element {
  const title = cycle.name ?? `${cycleNoun} ${String(cycle.number)}`;
  const taskPct =
    stats && stats.committed > 0 ? Math.round((stats.completed / stats.committed) * 100) : 0;

  return (
    <EntityListRow
      href={href}
      aria-label={title}
      render={(p) => (
        <Link
          href={p.href ?? href}
          className={p.className}
          onClick={p.onClick}
          aria-current={p['aria-current']}
        >
          {p.children}
        </Link>
      )}
      leading={
        <StatusIcon type={statusGlyphType(cycle.status)} label={STATUS_LABEL[cycle.status]} />
      }
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-on-surface truncate font-medium">{title}</span>
          {cycle.name ? (
            <span className="text-on-surface-variant shrink-0 text-xs font-normal tabular-nums">
              {cycleNoun} {cycle.number}
            </span>
          ) : null}
        </span>
      }
      subtitle={formatWindow(cycle.startsAt, cycle.endsAt)}
      meta={
        stats ? (
          <>
            <RowMeta tabular>
              <RowProgress
                value={taskPct}
                label={`${cycleNoun} ${String(cycle.number)} tasks complete`}
              />
              <span>
                <span className="text-on-surface font-medium">{stats.completed}</span>/
                {stats.committed}
              </span>
            </RowMeta>
            {stats.carryover > 0 && cycle.status !== 'completed' ? (
              <RowMeta tabular className="text-state-started font-medium">
                {stats.carryover} open
              </RowMeta>
            ) : (
              <RowMeta tabular>
                {stats.completedCapacity}/{stats.capacity} pts
              </RowMeta>
            )}
          </>
        ) : (
          <RowMeta>
            <Skeleton className="h-1.5 w-16 rounded-full" />
            <Skeleton className="h-3 w-16" />
          </RowMeta>
        )
      }
      trailing={
        <Badge variant={statusBadgeVariant(cycle.status)}>{STATUS_LABEL[cycle.status]}</Badge>
      }
    />
  );
}
