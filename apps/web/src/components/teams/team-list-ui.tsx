'use client';

/**
 * The Teams roster in list layout.
 *
 * @remarks
 * {@link EntityTable} owns the header, row chrome, responsive visibility, and scrollport. This
 * module keeps the Team-specific identity, counts, triage state, link, and object binding.
 */
import { defaultEntityDisplay, type EntityDisplayOut } from '@docket/work/entity-display-contract';
import { type TeamOut } from '../../lib/contracts/team';
import {
  type Column,
  EntityTable,
  type EntityTableProps,
  type EntityTableRowLinkProps,
} from '@docket/ui/components';
import { FolderKanban, ListChecks, Workflow } from '@docket/ui/icons';
import { Badge, Skeleton } from '@docket/ui/primitives';
import { createContext, type JSX, useContext } from 'react';

import Link from '@/components/docket-link';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { WorkCount } from '@/components/entity-display/roster-cells';
import { ObjectSurface } from '@/components/objects/object-surface';

/** The row view-model derived for one Team (scope + workflow roll-up). */
export interface TeamRow {
  team: TeamOut;
  display?: EntityDisplayOut | undefined;
  projectCount: number;
  taskCount: number;
  workflowStateCount: number;
}

/** Props for {@link TeamRows}. */
export type TeamRowsProps = NonNullable<EntityTableProps<TeamRow>['containerInteraction']> & {
  rows: readonly TeamRow[];
  /** The active workspace, used to build each row's link to its team page. */
  orgId: string;
  projectNoun: string;
  projectNounPlural: string;
  taskNoun: string;
  taskNounPlural: string;
  ariaLabel: string;
  className?: string | undefined;
};

const TeamRowContext = createContext<TeamRow | null>(null);

/** Remove explicit undefined values before forwarding the table's exact-optional link props. */
function definedRowLinkProps<T extends object>(
  value: T,
): {
  [K in keyof T]: Exclude<T[K], undefined>;
} {
  const result = {} as { [K in keyof T]: Exclude<T[K], undefined> };
  for (const key of Object.keys(value) as (keyof T)[]) {
    const fieldValue = value[key];
    if (fieldValue !== undefined) result[key] = fieldValue as Exclude<T[typeof key], undefined>;
  }
  return result;
}

/** Render EntityTable's row link through the existing Team object surface. */
function TeamRowLink(props: EntityTableRowLinkProps): JSX.Element {
  const row = useContext(TeamRowContext);
  if (row === null) throw new Error('TeamRowLink requires a Team row.');
  const object = {
    kind: 'team' as const,
    id: row.team.id,
    organizationId: row.team.organizationId,
    title: row.team.name,
  };
  return (
    <ObjectSurface object={object} surfaceId="team-list" href={props.href}>
      <Link {...definedRowLinkProps(props)} aria-label={`${row.team.key} ${row.team.name}`} />
    </ObjectSurface>
  );
}

/** Build the Team-specific cells while EntityTable owns their shared layout. */
function teamColumns({
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
}: Pick<
  TeamRowsProps,
  'projectNoun' | 'projectNounPlural' | 'taskNoun' | 'taskNounPlural'
>): readonly Column<TeamRow>[] {
  return [
    {
      key: 'team',
      header: 'Team',
      flex: true,
      minWidth: '22rem',
      render: ({ team, display }) => {
        const identity = display ?? defaultEntityDisplay('team', team.id);
        return (
          <span className="flex min-w-0 items-center gap-3 py-1">
            <EntityIconGlyph
              iconKey={identity.iconKey}
              colorKey={identity.colorKey}
              customColor={identity.customColor}
              size={40}
            />
            <span className="text-on-surface line-clamp-1 text-sm leading-5 font-semibold">
              <span className="sr-only">{team.key} </span>
              {team.name}
            </span>
          </span>
        );
      },
    },
    {
      key: 'states',
      header: 'States',
      width: '8rem',
      priority: 3,
      render: ({ workflowStateCount }) =>
        workflowStateCount > 0 ? (
          <span
            className="text-on-surface-variant flex items-center gap-1.5 text-sm tabular-nums"
            aria-label={`${String(workflowStateCount)} workflow states`}
          >
            <Workflow aria-hidden="true" className="size-4" />
            {workflowStateCount}
            <span className="sr-only">workflow states</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'projects',
      header: 'Projects',
      width: '8rem',
      priority: 2,
      render: ({ projectCount }) => (
        <span
          aria-label={`${String(projectCount)} ${projectCount === 1 ? projectNoun : projectNounPlural}`}
        >
          <WorkCount
            icon={FolderKanban}
            value={projectCount}
            noun={projectCount === 1 ? projectNoun : projectNounPlural}
            token="body-medium"
          />
        </span>
      ),
    },
    {
      key: 'tasks',
      header: 'Tasks',
      width: '12rem',
      priority: 1,
      render: ({ taskCount, team }) => (
        <span className="flex w-full items-center justify-between gap-2">
          <span aria-label={`${String(taskCount)} ${taskCount === 1 ? taskNoun : taskNounPlural}`}>
            <WorkCount
              icon={ListChecks}
              value={taskCount}
              noun={taskCount === 1 ? taskNoun : taskNounPlural}
              token="body-medium"
            />
          </span>
          {team.triageEnabled ? <Badge variant="secondary">Triage</Badge> : null}
        </span>
      ),
    },
  ];
}

/** Render Team rows through the shared responsive table. */
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
  const columns = teamColumns({ projectNoun, projectNounPlural, taskNoun, taskNounPlural });
  return (
    <EntityTable<TeamRow>
      aria-label={ariaLabel}
      columns={columns}
      rows={rows}
      getRowKey={({ team }) => team.id}
      tone="tonal"
      rowHeight={56}
      rowHref={({ team }) => `/orgs/${orgId}/teams/${team.id}`}
      renderRowLink={(props) => <TeamRowLink {...props} />}
      renderRowInteraction={({ row, children }) => (
        <TeamRowContext.Provider value={row}>
          {children({
            selected: false,
            rowProps: { 'aria-selected': false, 'data-selected': false },
          })}
        </TeamRowContext.Provider>
      )}
      containerInteraction={rest}
      className={className}
    />
  );
}

/** Loading placeholder: plain row-height skeleton blocks, matching the other rosters. */
export function ListSkeleton(): JSX.Element {
  return (
    <div className="bg-surface-container-low flex flex-col gap-2 rounded-xl p-2" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}
