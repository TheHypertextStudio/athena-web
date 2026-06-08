'use client';

/**
 * One Project card in the Projects list.
 *
 * @remarks
 * A Project is a *bounded* effort, so its card leads with identity, lifecycle, and health:
 * the name, the lifecycle {@link ProjectStatusBadge}, and the {@link HealthPill} sit on the
 * header line; the description (when present) reads below; a footer carries the lead (an
 * {@link ActorAvatar} + name) and the task scope ("N tasks") so the roster is scannable at a
 * glance. The whole card is a keyboard-activatable button that opens the Project detail, with
 * a focus ring and a hover lift.
 */
import type { Health } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { ListChecks } from '@docket/ui/icons';
import type { JSX } from 'react';

import { HealthPill, ProjectStatusBadge } from './project-status';

/** The view-model one Project card renders. */
export interface ProjectCardData {
  /** Stable project id. */
  id: string;
  /** Project name. */
  name: string;
  /** Short description, when set. */
  description: string | null | undefined;
  /** Lifecycle status (planned | active | completed | canceled). */
  status: string;
  /** Health verdict, or `null` when unset. */
  health: Health | null;
  /** The accountable lead's display name, or `null` when unassigned. */
  leadName: string | null;
  /** Number of tasks in the project. */
  taskCount: number;
}

/** Props for {@link ProjectCard}. */
export interface ProjectCardProps {
  /** The card's view-model. */
  project: ProjectCardData;
  /** Singular noun for a task (vocabulary-skinned), lower-cased for inline copy. */
  taskNoun: string;
  /** Plural noun for a task (vocabulary-skinned), lower-cased for inline copy. */
  taskNounPlural: string;
  /** Open the Project detail for this card. */
  onOpen: (projectId: string) => void;
}

/**
 * A single Project list card.
 *
 * @param props - The {@link ProjectCardProps}.
 * @returns the rendered card.
 */
export function ProjectCard({
  project,
  taskNoun,
  taskNounPlural,
  onOpen,
}: ProjectCardProps): JSX.Element {
  const taskWord = project.taskCount === 1 ? taskNoun : taskNounPlural;

  return (
    <button
      type="button"
      onClick={() => {
        onOpen(project.id);
      }}
      className="group border-outline-variant bg-surface-container-low hover:bg-surface-container-high focus-visible:ring-ring flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-1"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-on-surface min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          {project.name}
        </h2>
        <ProjectStatusBadge status={project.status} />
      </div>

      <HealthPill health={project.health} />

      {project.description ? (
        <p className="text-on-surface-variant line-clamp-2 text-sm leading-relaxed">
          {project.description}
        </p>
      ) : null}

      <div className="border-outline-variant text-on-surface-variant mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-xs">
        <span className="flex items-center gap-1.5">
          {project.leadName ? (
            <>
              <ActorAvatar kind="human" name={project.leadName} size={18} />
              <span className="text-on-surface/80 font-medium">{project.leadName}</span>
            </>
          ) : (
            <span className="italic">No lead</span>
          )}
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <ListChecks aria-hidden="true" className="size-3.5" />
          {project.taskCount} {taskWord}
        </span>
      </div>
    </button>
  );
}
