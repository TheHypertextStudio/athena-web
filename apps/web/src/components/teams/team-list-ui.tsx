'use client';

/**
 * The Teams roster — a 72px identity-row grid, standardized with Initiatives/Programs/Projects/
 * Cycles.
 *
 * @remarks
 * Previously rendered through the dense `EntityListRow` family (36px "comfortable" rows, `tone=
 * "bordered"`, `interactive={false}` since a team has no destination screen yet). This hand-rolls
 * the same aligned-column grid the other rosters use — a team's identity is its short `key`
 * (`ENG`, `OPS`, …), so the leading glyph is that key set inside an {@link IdentityGlyph} circle
 * (the same 40px weight `StatusGlyph`/`ProgramGlyph` use elsewhere) rather than the small inline
 * mono chip it rendered before.
 */
import type { TeamOut } from '@docket/types';
import { IdentityGlyph } from '@docket/ui/components';
import { FolderKanban, ListChecks, Workflow } from '@docket/ui/icons';
import { dragSourceProps } from '@docket/ui/lib/draggable';
import { cn } from '@docket/ui/lib/utils';
import { Badge, Skeleton } from '@docket/ui/primitives';
import type { ComponentPropsWithoutRef, JSX } from 'react';
import { useRef } from 'react';

import { entityDragSource } from '@/lib/entity-drag';

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
  projectNoun: string;
  projectNounPlural: string;
  taskNoun: string;
  taskNounPlural: string;
  ariaLabel: string;
}

/** Column widths shared by {@link TeamRows}'s header and each data row. */
const ROW_GRID = 'grid-cols-[minmax(20rem,1fr)_7rem_7rem_7rem]';

/** One 72px team row. Rows have no destination yet, but each is still a drag source for its team. */
function TeamGridRow({
  team,
  projectCount,
  taskCount,
  workflowStateCount,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
}: TeamRow &
  Pick<
    TeamRowsProps,
    'projectNoun' | 'projectNounPlural' | 'taskNoun' | 'taskNounPlural'
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
    <div
      role="row"
      aria-label={`${team.key} ${team.name}`}
      {...dragProps}
      className={cn('grid min-h-[72px] items-center rounded-lg', ROW_GRID, dragProps?.className)}
    >
      <div className="flex min-w-0 items-center gap-3 px-2 py-2">
        <IdentityGlyph>
          <span className="text-xs font-semibold">{team.key}</span>
        </IdentityGlyph>
        <span className="text-on-surface line-clamp-1 text-sm leading-5 font-semibold">
          {team.name}
        </span>
      </div>
      <div className="text-on-surface-variant flex items-center gap-1.5 px-3 text-sm tabular-nums">
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
      <div className="text-on-surface-variant flex items-center gap-1.5 px-3 text-sm tabular-nums">
        <FolderKanban aria-hidden="true" className="size-4" />
        {projectCount}
        <span className="sr-only">{projectWord}</span>
      </div>
      <div className="flex items-center justify-between gap-2 px-3">
        <span className="text-on-surface-variant flex items-center gap-1.5 text-sm tabular-nums">
          <ListChecks aria-hidden="true" className="size-4" />
          {taskCount}
          <span className="sr-only">{taskWord}</span>
        </span>
        {team.triageEnabled ? <Badge variant="secondary">Triage</Badge> : null}
      </div>
    </div>
  );
}

/**
 * The Teams roster frame: the 72px-row grid's shared column header + its data rows.
 *
 * @remarks
 * Rows have no destination yet, so they stay inert — but each one is still a drag source for its
 * team, which is what lets a team be dropped onto a target that scopes work to it.
 */
export function TeamRows({
  rows,
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
        <div role="grid" aria-label={ariaLabel} className="min-w-[42rem] text-sm">
          <div
            role="row"
            className={cn('text-on-surface-variant grid h-8 items-center text-xs', ROW_GRID)}
          >
            <div role="columnheader" className="px-3 pl-14 font-medium">
              Team
            </div>
            <div role="columnheader" className="px-3 font-medium">
              States
            </div>
            <div role="columnheader" className="px-3 font-medium">
              Projects
            </div>
            <div role="columnheader" className="px-3 font-medium">
              Tasks
            </div>
          </div>
          {rows.map((row) => (
            <TeamGridRow
              key={row.team.id}
              {...row}
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
        <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
      ))}
    </div>
  );
}
