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

/** A tonal {@link EntityList} of program rows (shared by the flat + grouped renders). */
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
    <EntityList aria-label={ariaLabel} tone="tonal">
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

/** Loading placeholder: plain row-height skeleton blocks, matching the Projects/Initiatives lists. */
export function ListSkeleton(): JSX.Element {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-[72px] w-full" />
      ))}
    </div>
  );
}
