'use client';

/**
 * One Program card in the Programs list.
 *
 * @remarks
 * A Program is an *ongoing* line of work, so its card leads with identity and health rather
 * than a completion bar: the name, the lifecycle {@link ProgramStatusBadge}, and the
 * {@link HealthPill} sit on the header line; the description (when present) reads below; a
 * footer carries the owner (an {@link ActorAvatar} + name) and the child-work scope
 * ("N projects · M tasks") so the roster is scannable at a glance. The whole card is a
 * keyboard-activatable link to the Program detail, with a focus ring and a hover lift.
 */
import type { Health, ProgramStatus } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { FolderKanban, ListChecks } from '@docket/ui/icons';
import type { JSX } from 'react';

import { HealthPill, ProgramStatusBadge } from './program-status';

/** The view-model one Program card renders. */
export interface ProgramCardData {
  /** Stable program id. */
  id: string;
  /** Program name. */
  name: string;
  /** Short description, when set. */
  description: string | null | undefined;
  /** Lifecycle status. */
  status: ProgramStatus;
  /** Health verdict, or `null` when unset. */
  health: Health | null;
  /** The accountable owner's display name, or `null` when unassigned. */
  ownerName: string | null;
  /** Number of projects under the program. */
  projectCount: number;
  /** Number of active tasks under the program (directly or via its projects). */
  taskCount: number;
}

/** Props for {@link ProgramCard}. */
export interface ProgramCardProps {
  /** The card's view-model. */
  program: ProgramCardData;
  /** Singular noun for a project (vocabulary-skinned), lower-cased for inline copy. */
  projectNoun: string;
  /** Plural noun for a project (vocabulary-skinned), lower-cased for inline copy. */
  projectNounPlural: string;
  /** Singular noun for a task (vocabulary-skinned), lower-cased for inline copy. */
  taskNoun: string;
  /** Plural noun for a task (vocabulary-skinned), lower-cased for inline copy. */
  taskNounPlural: string;
  /** Open the Program detail for this card. */
  onOpen: (programId: string) => void;
}

/**
 * A single Program list card.
 *
 * @param props - The {@link ProgramCardProps}.
 * @returns the rendered card.
 */
export function ProgramCard({
  program,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
  onOpen,
}: ProgramCardProps): JSX.Element {
  const projectWord = program.projectCount === 1 ? projectNoun : projectNounPlural;
  const taskWord = program.taskCount === 1 ? taskNoun : taskNounPlural;

  return (
    <button
      type="button"
      onClick={() => {
        onOpen(program.id);
      }}
      className="group border-outline-variant bg-surface-container-low hover:bg-surface-container-high focus-visible:ring-ring flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-1"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-on-surface min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          {program.name}
        </h2>
        <ProgramStatusBadge status={program.status} />
      </div>

      <HealthPill health={program.health} />

      {program.description ? (
        <p className="text-on-surface-variant line-clamp-2 text-sm leading-relaxed">
          {program.description}
        </p>
      ) : null}

      <div className="border-outline-variant text-on-surface-variant mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-xs">
        <span className="flex items-center gap-1.5">
          {program.ownerName ? (
            <>
              <ActorAvatar kind="human" name={program.ownerName} size={18} />
              <span className="text-on-surface font-medium">{program.ownerName}</span>
            </>
          ) : (
            <span className="italic">No owner</span>
          )}
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <FolderKanban aria-hidden="true" className="size-3.5" />
          {program.projectCount} {projectWord}
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <ListChecks aria-hidden="true" className="size-3.5" />
          {program.taskCount} {taskWord}
        </span>
      </div>
    </button>
  );
}
