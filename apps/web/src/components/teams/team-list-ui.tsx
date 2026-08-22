'use client';

/**
 * The Teams roster in list layout — a 56px identity-row grid, standardized with Initiatives /
 * Programs / Projects / Cycles.
 *
 * @remarks
 * The alternative to the card grid, which is the hub's default. Rows earn their place for the one
 * job cards do badly: comparing counts down an aligned column.
 *
 * Rows used to be inert, because a team had no destination screen — and were nonetheless wired as
 * drag sources whose payload no drop target in the app accepted, so a row could be picked up and
 * put nowhere. Now that a team has a page, the row is a link to it and the drag has a meaning, so
 * both halves of that contradiction are gone.
 *
 * A team's identity is its short `key` (`ENG`, `OPS`, …), so the leading glyph is that key set
 * inside an {@link IdentityGlyph} circle at the same 40px weight `StatusGlyph`/`ProgramGlyph` use.
 */
import type { TeamOut } from '@docket/types';
import { IdentityGlyph } from '@docket/ui/components';
import { FolderKanban, ListChecks, Workflow } from '@docket/ui/icons';
import { dragSourceProps } from '@docket/ui/lib/draggable';
import { cn } from '@docket/ui/lib/utils';
import { Badge, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import type { ComponentPropsWithoutRef, JSX } from 'react';
import { useRef } from 'react';

import { entityDragSource } from '@/lib/entity-drag';
import { ROSTER_DATA_CELL_CLASS, ROSTER_HEADER_CELL_CLASS } from '@/components/views/roster-grid';

/** The row view-model derived for one Team (scope + workflow roll-up). */
export interface TeamRow {
  team: TeamOut;
  projectCount: number;
  taskCount: number;
  workflowStateCount: number;
}

/**
 * Props for {@link TeamRows}.
 *
 * @remarks
 * Extends the outer wrapper's own div props so a caller can pass `className`, `data-*`, `id`, or
 * an event handler straight through to the roster frame, matching {@link ProgramRows}'s contract.
 */
export interface TeamRowsProps extends ComponentPropsWithoutRef<'div'> {
  rows: readonly TeamRow[];
  /** The active workspace, used to build each row's link to its team page. */
  orgId: string;
  projectNoun: string;
  projectNounPlural: string;
  taskNoun: string;
  taskNounPlural: string;
  ariaLabel: string;
}

/** Column widths shared by {@link TeamRows}'s header and each data row. */
const ROW_GRID = 'grid-cols-[minmax(22rem,1fr)_8rem_8rem_12rem]';

/** One 56px team row: a link to the team's page, and a drag source for the team itself. */
function TeamGridRow({
  team,
  projectCount,
  taskCount,
  workflowStateCount,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
  orgId,
}: TeamRow &
  Pick<
    TeamRowsProps,
    'orgId' | 'projectNoun' | 'projectNounPlural' | 'taskNoun' | 'taskNounPlural'
  >): JSX.Element {
  const dragOccurredRef = useRef(false);
  const dragProps = dragSourceProps(
    entityDragSource(
      { kind: 'team', id: team.id, organizationId: team.organizationId, title: team.name },
      {
        onDragStart: () => {
          dragOccurredRef.current = true;
        },
        onDragEnd: () => {
          window.setTimeout(() => {
            dragOccurredRef.current = false;
          }, 0);
        },
      },
    ),
  );
  const projectWord = projectCount === 1 ? projectNoun : projectNounPlural;
  const taskWord = taskCount === 1 ? taskNoun : taskNounPlural;

  return (
    <Link
      role="row"
      href={`/orgs/${orgId}/teams/${team.id}`}
      aria-label={`${team.key} ${team.name}`}
      onClick={(event) => {
        // A drag that ends over this row still fires a click. Swallowing it keeps a drop from
        // navigating away from the screen the person was arranging.
        if (dragOccurredRef.current) event.preventDefault();
      }}
      {...dragProps}
      className={cn(
        'hover:bg-surface-container focus-visible:ring-ring grid min-h-14 items-center',
        'rounded-lg transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none',
        ROW_GRID,
        dragProps?.className,
      )}
    >
      <div className={`${ROSTER_DATA_CELL_CLASS} gap-3 py-2`}>
        <IdentityGlyph>
          <span className="text-xs font-semibold">{team.key}</span>
        </IdentityGlyph>
        <span className="text-on-surface line-clamp-1 text-sm leading-5 font-semibold">
          {team.name}
        </span>
      </div>
      <div
        className={`${ROSTER_DATA_CELL_CLASS} text-on-surface-variant gap-1.5 text-sm tabular-nums`}
      >
        {workflowStateCount > 0 ? (
          <>
            <Workflow aria-hidden="true" className="size-4" />
            {workflowStateCount}
            <span className="sr-only">workflow states</span>
          </>
        ) : (
          '—'
        )}
      </div>
      <div
        className={`${ROSTER_DATA_CELL_CLASS} text-on-surface-variant gap-1.5 text-sm tabular-nums`}
      >
        <FolderKanban aria-hidden="true" className="size-4" />
        {projectCount}
        <span className="sr-only">{projectWord}</span>
      </div>
      <div className={`${ROSTER_DATA_CELL_CLASS} justify-between gap-2`}>
        <span className="text-on-surface-variant flex items-center gap-1.5 text-sm tabular-nums">
          <ListChecks aria-hidden="true" className="size-4" />
          {taskCount}
          <span className="sr-only">{taskWord}</span>
        </span>
        {team.triageEnabled ? <Badge variant="secondary">Triage</Badge> : null}
      </div>
    </Link>
  );
}

/**
 * The Teams roster frame: the 56px-row grid's shared column header + its data rows.
 *
 * @remarks
 * Each row opens its team and is a drag source for it, which is what lets a team be dropped onto a
 * target that scopes work to it.
 */
export function TeamRows({
  rows,
  orgId,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
  ariaLabel,
  className,
  ...rest
}: TeamRowsProps): JSX.Element {
  return (
    <div {...rest} className={cn('bg-surface-container-low relative rounded-xl p-2', className)}>
      <div className="overflow-x-auto overscroll-x-contain pb-1">
        <div role="grid" aria-label={ariaLabel} className="min-w-[52rem] text-sm">
          <div
            role="row"
            className={cn('text-on-surface-variant grid h-8 items-center text-xs', ROW_GRID)}
          >
            <div role="columnheader" className={`${ROSTER_HEADER_CELL_CLASS} pl-16`}>
              Team
            </div>
            <div role="columnheader" className={ROSTER_HEADER_CELL_CLASS}>
              States
            </div>
            <div role="columnheader" className={ROSTER_HEADER_CELL_CLASS}>
              Projects
            </div>
            <div role="columnheader" className={ROSTER_HEADER_CELL_CLASS}>
              Tasks
            </div>
          </div>
          {rows.map((row) => (
            <TeamGridRow
              key={row.team.id}
              {...row}
              orgId={orgId}
              projectNoun={projectNoun}
              projectNounPlural={projectNounPlural}
              taskNoun={taskNoun}
              taskNounPlural={taskNounPlural}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Loading placeholder: plain row-height skeleton blocks, matching the other rosters. */
export function ListSkeleton(): JSX.Element {
  // placeholder: the team rows — how many teams the workspace has and each one's name, key and
  // member count. The roster's heading and "New team" action are static copy.
  return (
    <div className="bg-surface-container-low flex flex-col gap-2 rounded-xl p-2" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}
