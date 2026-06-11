'use client';

import type { TeamOut } from '@docket/types';
import { EntityList, EntityListRow, RowMeta } from '@docket/ui/components';
import { FolderKanban, ListChecks, Workflow } from '@docket/ui/icons';
import { Badge, Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** The row view-model derived for one Team (scope + workflow roll-up). */
export interface TeamRow {
  team: TeamOut;
  projectCount: number;
  taskCount: number;
  workflowStateCount: number;
}

/** Props for {@link TeamRows}. */
export interface TeamRowsProps {
  rows: readonly TeamRow[];
  projectNoun: string;
  projectNounPlural: string;
  taskNoun: string;
  taskNounPlural: string;
  ariaLabel: string;
}

/** A bordered {@link EntityList} of team rows (shared by the flat + grouped renders). */
export function TeamRows({
  rows,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
  ariaLabel,
}: TeamRowsProps): JSX.Element {
  return (
    <EntityList aria-label={ariaLabel}>
      {rows.map(({ team, projectCount, taskCount, workflowStateCount }) => {
        const projectWord = projectCount === 1 ? projectNoun : projectNounPlural;
        const taskWord = taskCount === 1 ? taskNoun : taskNounPlural;
        return (
          <EntityListRow
            key={team.id}
            interactive={false}
            aria-label={`${team.key} ${team.name}`}
            leading={
              <span className="bg-surface-container text-on-surface-variant rounded px-1.5 py-0.5 font-mono text-xs font-medium">
                {team.key}
              </span>
            }
            title={team.name}
            meta={
              <>
                {workflowStateCount > 0 ? (
                  <RowMeta tabular>
                    <Workflow aria-hidden="true" className="size-3.5" />
                    {workflowStateCount} states
                  </RowMeta>
                ) : null}
                <RowMeta tabular>
                  <FolderKanban aria-hidden="true" className="size-3.5" />
                  {projectCount} {projectWord}
                </RowMeta>
                <RowMeta tabular>
                  <ListChecks aria-hidden="true" className="size-3.5" />
                  {taskCount} {taskWord}
                </RowMeta>
              </>
            }
            trailing={team.triageEnabled ? <Badge variant="secondary">Triage</Badge> : null}
          />
        );
      })}
    </EntityList>
  );
}

/** Loading placeholder: a bordered list of slim row skeletons. */
export function ListSkeleton(): JSX.Element {
  return (
    <div
      className="border-outline-variant divide-outline-variant flex flex-col divide-y overflow-hidden rounded-xl border"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="h-5 w-10 rounded" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
