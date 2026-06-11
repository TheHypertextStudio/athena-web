'use client';

import type { ProgramOut } from '@docket/types';
import { ActorAvatar, EntityList, EntityListRow, RowMeta, StatusIcon } from '@docket/ui/components';
import { FolderKanban, ListChecks } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

import {
  HealthDot,
  ProgramStatusBadge,
  STATUS_LABEL,
  statusGlyphType,
} from '@/components/programs/program-status';

/** The row view-model derived for one Program (owner + child-work roll-up). */
export interface ProgramRow {
  program: ProgramOut;
  ownerName: string | null;
  projectCount: number;
  taskCount: number;
}

/** Props for {@link ProgramRows}. */
export interface ProgramRowsProps {
  rows: readonly ProgramRow[];
  projectNoun: string;
  projectNounPlural: string;
  taskNoun: string;
  taskNounPlural: string;
  ariaLabel: string;
  onOpen: (programId: string) => void;
}

/** A bordered {@link EntityList} of program rows (shared by the flat + grouped renders). */
export function ProgramRows({
  rows,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
  ariaLabel,
  onOpen,
}: ProgramRowsProps): JSX.Element {
  return (
    <EntityList aria-label={ariaLabel}>
      {rows.map(({ program, ownerName, projectCount, taskCount }) => {
        const projectWord = projectCount === 1 ? projectNoun : projectNounPlural;
        const taskWord = taskCount === 1 ? taskNoun : taskNounPlural;
        return (
          <EntityListRow
            key={program.id}
            leading={
              <StatusIcon
                type={statusGlyphType(program.status)}
                label={STATUS_LABEL[program.status]}
              />
            }
            title={program.name}
            onActivate={() => {
              onOpen(program.id);
            }}
            meta={
              <>
                {ownerName ? (
                  <RowMeta>
                    <ActorAvatar kind="human" name={ownerName} size={18} />
                    <span className="text-on-surface/80 font-medium">{ownerName}</span>
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
            trailing={
              <>
                <HealthDot health={program.health ?? null} />
                <ProgramStatusBadge status={program.status} />
              </>
            }
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
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
