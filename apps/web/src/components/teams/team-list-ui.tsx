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
 * The display registry supplies each team's icon and color. The short team key remains available
 * to assistive technology without becoming the only visual identity.
 */
import { defaultEntityDisplay, type EntityDisplayOut } from '@docket/work/entity-display-contract';
import { type TeamOut } from '../../lib/contracts/team';
import { FolderKanban, ListChecks, Workflow } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Badge, Skeleton } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { ObjectSurface } from '@/components/objects/object-surface';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { WorkCount } from '@/components/entity-display/roster-cells';
import { ROSTER_DATA_CELL_CLASS, ROSTER_HEADER_CELL_CLASS } from '@/components/views/roster-grid';

/** The row view-model derived for one Team (scope + workflow roll-up). */
export interface TeamRow {
  team: TeamOut;
  display?: EntityDisplayOut | undefined;
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
  display,
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
  const projectWord = projectCount === 1 ? projectNoun : projectNounPlural;
  const taskWord = taskCount === 1 ? taskNoun : taskNounPlural;
  const href = `/orgs/${orgId}/teams/${team.id}`;
  const identity = display ?? defaultEntityDisplay('team', team.id);

  return (
    <ObjectSurface
      object={{
        kind: 'team',
        id: team.id,
        organizationId: team.organizationId,
        title: team.name,
      }}
      surfaceId="team-list"
      href={href}
    >
      <Link
        role="row"
        href={href}
        aria-label={`${team.key} ${team.name}`}
        className={cn(
          'hover:bg-surface-container focus-visible:ring-ring grid min-h-14 items-center',
          'rounded-lg transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none',
          ROW_GRID,
        )}
      >
        <div className={`${ROSTER_DATA_CELL_CLASS} gap-3 py-2`}>
          <EntityIconGlyph
            iconKey={identity.iconKey}
            colorKey={identity.colorKey}
            customColor={identity.customColor}
            size={40}
          />
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
        <div className={ROSTER_DATA_CELL_CLASS}>
          <WorkCount
            icon={FolderKanban}
            value={projectCount}
            noun={projectWord}
            token="body-medium"
          />
        </div>
        <div className={`${ROSTER_DATA_CELL_CLASS} justify-between gap-2`}>
          <WorkCount icon={ListChecks} value={taskCount} noun={taskWord} token="body-medium" />
          {team.triageEnabled ? <Badge variant="secondary">Triage</Badge> : null}
        </div>
      </Link>
    </ObjectSurface>
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
