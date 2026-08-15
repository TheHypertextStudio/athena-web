'use client';

/**
 * The Cycles roster — a 72px identity-row grid, standardized with Initiatives/Programs/Projects.
 *
 * @remarks
 * Previously rendered through the dense `EntityListRow` family (36px "comfortable" rows) inside a
 * bordered {@link EntityList}. That read visibly smaller than the other core-object rosters even
 * though a cycle carries the same tier of information (status, a completion pace, a points
 * roll-up) — so this hand-rolls the same aligned-column grid Initiatives/Programs/Projects use.
 * {@link CycleRows} owns the frame + column header (mirroring `ProgramRows`); {@link CycleRow} is
 * one row, still a link to the cycle detail and a drag source for the cycle itself.
 */
import type { CycleOut, CycleStats } from '@docket/types';
import { StatusGlyph } from '@docket/ui/components';
import { dragSourceProps } from '@docket/ui/lib/draggable';
import { cn } from '@docket/ui/lib/utils';
import { Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';
import { entityDragSource } from '@/lib/entity-drag';

import { formatWindow } from './format-window';
import { WorkStatusBadge } from '@/components/entity-display/work-status';

import { CYCLE_STATUS } from './cycle-status';

/** Column widths shared by {@link CycleRows}'s header and each {@link CycleRow}. */
const ROW_GRID = 'grid-cols-[minmax(20rem,1fr)_7rem_10rem_8rem]';

/** Props for {@link CycleRow}. */
export interface CycleRowProps {
  /** The cycle to summarize. */
  cycle: CycleOut;
  /** The cycle's rolled-up stats, or `null` while they load (or if they failed). */
  stats: CycleStats | null;
  /**
   * The owning team's display name.
   *
   * @remarks
   * Every cycle belongs to exactly one team, but the roster is org-wide: grouping by status
   * (the default view) can legitimately place several teams' own current cadences side by
   * side, each correctly "Active." Without a team name on the row, that reads as a bug
   * ("why are there three active cycles?") rather than as several teams each running their
   * own week — so the row always names its team, not only when grouped by team.
   */
  teamName: string;
  /** The (vocabulary-resolved) singular cycle noun (e.g. "Cycle", "Sprint"). */
  cycleNoun: string;
  /** Href to the cycle's detail screen. */
  href: string;
  /** Warm the cycle-detail cache on hover/focus so the row opens instantly (prefetch-on-intent). */
  onPrefetch?: (() => void) | undefined;
  /** Whether the viewer may rename this cycle in place (double-click the title). */
  canRename?: boolean | undefined;
  /** Persist a renamed cycle name. Enables inline rename when provided with `canRename`. */
  onRename?: ((cycleId: string, name: string) => void) | undefined;
  /** Open the cycle — used by the inline title so a single click still navigates. */
  onOpen?: (() => void) | undefined;
}

/**
 * A single cycle summary row linking to its detail.
 *
 * @example
 * ```tsx
 * <CycleRow cycle={cycle} stats={stats} cycleNoun="Cycle" href={`/orgs/${orgId}/cycles/${cycle.id}`} />
 * ```
 */
export function CycleRow({
  cycle,
  stats,
  teamName,
  cycleNoun,
  href,
  onPrefetch,
  canRename,
  onRename,
  onOpen,
}: CycleRowProps): JSX.Element {
  // The rendered identity is always the server-derived `displayName` — the author's name when the
  // cycle has one, otherwise its window ("Jul 27 – Aug 2"). The stored `number` is the auto-roll
  // idempotency key (1000137) and is never shown; the row used to print it both as the title
  // fallback and as a trailing chip beside a named cycle.
  const title = cycle.displayName;
  // The window rides beside the team name only when it isn't already the title: an unnamed
  // cycle's title already IS its window, so repeating it would print the same string twice.
  const subtitle = cycle.name
    ? `${formatWindow(cycle.startsAt, cycle.endsAt)} · ${teamName}`
    : teamName;
  const taskPct =
    stats && stats.committed > 0 ? Math.round((stats.completed / stats.committed) * 100) : 0;

  const dragProps = dragSourceProps(
    entityDragSource({
      kind: 'cycle',
      id: cycle.id,
      organizationId: cycle.organizationId,
      title,
    }),
  );

  const status = CYCLE_STATUS[cycle.status];

  return (
    <Link
      href={href}
      role="row"
      aria-label={`${title}, ${teamName}`}
      {...dragProps}
      {...(onPrefetch !== undefined ? { onMouseEnter: onPrefetch, onFocus: onPrefetch } : {})}
      className={cn(
        'hover:bg-surface-container-high grid min-h-[72px] cursor-pointer items-center rounded-lg transition-colors',
        ROW_GRID,
        dragProps?.className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3 px-2 py-2">
        <StatusGlyph type={status.category} label={status.name} />
        <div className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            {canRename && onRename ? (
              // Rename writes `name` and only `name`, so an unnamed cycle opens an EMPTY field
              // with its window as the placeholder — never pre-filled with a derived title the
              // author did not write.
              <EditableTitle
                value={cycle.name ?? ''}
                onSave={(name) => {
                  onRename(cycle.id, name);
                }}
                canEdit
                activate="doubleClick"
                {...(onOpen ? { onActivate: onOpen } : {})}
                ariaLabel={`${cycleNoun} name`}
                placeholder={cycle.displayName}
                className="text-on-surface text-body-medium line-clamp-1 min-w-0 font-medium"
              />
            ) : (
              <span className="text-on-surface text-body-medium line-clamp-1 font-medium">
                {title}
              </span>
            )}
          </span>
          <p className="text-on-surface-variant text-body-small mt-0.5 truncate">{subtitle}</p>
        </div>
      </div>
      <div className="px-3">
        <WorkStatusBadge name={status.name} category={status.category} />
      </div>
      <div className="px-3">
        {stats ? (
          <div className="flex items-center gap-2">
            <div className="bg-surface-container-highest h-1.5 w-14 overflow-hidden rounded-full">
              <span
                className="bg-primary block h-full rounded-full"
                style={{ width: `${taskPct}%` }}
              />
            </div>
            <span className="text-body-medium tabular-nums">
              <span className="text-on-surface font-medium">{stats.completed}</span>
              <span className="text-on-surface-variant">/{stats.committed}</span>
            </span>
          </div>
        ) : (
          // placeholder: this cycle's completion stats — the committed/completed counts behind the
          // progress bar. They come from a separate per-cycle read, so the row's name, dates and
          // status render immediately and only the numbers wait.
          <div className="flex items-center gap-2">
            <Skeleton className="h-1.5 w-14 rounded-full" />
            <Skeleton className="h-3 w-10" />
          </div>
        )}
      </div>
      <div className="text-on-surface-variant text-body-medium px-3 tabular-nums">
        {stats ? (
          stats.carryover > 0 && cycle.status !== 'completed' ? (
            <span className="text-state-started font-medium">{stats.carryover} open</span>
          ) : (
            <span>
              {stats.completedCapacity}/{stats.capacity} pts
            </span>
          )
        ) : (
          <Skeleton className="h-3 w-12" />
        )}
      </div>
    </Link>
  );
}

/**
 * Props for {@link CycleRows}.
 *
 * @remarks
 * Extends the outer wrapper's own div props so a caller can pass `className`, `data-*`, `id`, or
 * an event handler straight through to the roster frame, matching {@link ProgramRows}'s contract.
 */
export interface CycleRowsProps extends ComponentPropsWithoutRef<'div'> {
  /** The cycle rows to render, in order. */
  rows: readonly CycleRowProps[];
  /** Accessible label for the roster grid. */
  ariaLabel: string;
}

/** The Cycles roster frame: the 72px-row grid's shared column header + its data rows. */
export function CycleRows({ rows, ariaLabel, className, ...rest }: CycleRowsProps): JSX.Element {
  return (
    <div {...rest} className={cn('bg-surface-container-low relative rounded-xl p-2', className)}>
      <div className="overflow-x-auto overscroll-x-contain pb-1">
        <div role="grid" aria-label={ariaLabel} className="text-body-medium min-w-[46rem]">
          <div
            role="row"
            className={cn(
              'text-on-surface-variant text-label-medium grid h-8 items-center',
              ROW_GRID,
            )}
          >
            <div role="columnheader" className="px-3 pl-14">
              Cycle
            </div>
            <div role="columnheader" className="px-3">
              Status
            </div>
            <div role="columnheader" className="px-3">
              Progress
            </div>
            <div role="columnheader" className="px-3">
              Points
            </div>
          </div>
          {rows.map((row) => (
            <CycleRow key={row.cycle.id} {...row} />
          ))}
        </div>
      </div>
    </div>
  );
}
