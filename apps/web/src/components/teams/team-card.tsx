'use client';

/**
 * One Team card in the Teams list.
 *
 * @remarks
 * A Team is a first-class unit that owns its own workflow states, cycles, and Triage queue.
 * Its card leads with identity — the team `key` as a monospace chip, the name, and a Triage
 * {@link Badge} when the team's queue is enabled — with the description below. A footer carries
 * the team's scope: how many projects and tasks it owns, so the roster is scannable at a
 * glance.
 *
 * The card is a non-interactive presentational tile: there is no team-detail screen yet, so it
 * deliberately exposes no click target rather than linking to a route that would 404. When a
 * team-detail screen lands, this becomes a button (mirroring {@link ProjectCard}).
 */
import { Users } from '@docket/ui/icons';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** The view-model one Team card renders. */
export interface TeamCardData {
  /** Stable team id. */
  id: string;
  /** Team name. */
  name: string;
  /** Org-unique team key (e.g. "ENG"). */
  key: string;
  /** Short description, when set. */
  description: string | null | undefined;
  /** Whether the team's Triage queue is enabled. */
  triageEnabled: boolean;
  /** Number of projects owned by the team. */
  projectCount: number;
  /** Number of tasks owned by the team. */
  taskCount: number;
}

/** Props for {@link TeamCard}. */
export interface TeamCardProps {
  /** The card's view-model. */
  team: TeamCardData;
  /** Singular noun for a project (vocabulary-skinned), lower-cased for inline copy. */
  projectNoun: string;
  /** Plural noun for a project (vocabulary-skinned), lower-cased for inline copy. */
  projectNounPlural: string;
  /** Singular noun for a task (vocabulary-skinned), lower-cased for inline copy. */
  taskNoun: string;
  /** Plural noun for a task (vocabulary-skinned), lower-cased for inline copy. */
  taskNounPlural: string;
}

/**
 * A single Team list card.
 *
 * @param props - The {@link TeamCardProps}.
 * @returns the rendered card.
 */
export function TeamCard({
  team,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
}: TeamCardProps): JSX.Element {
  const projectWord = team.projectCount === 1 ? projectNoun : projectNounPlural;
  const taskWord = team.taskCount === 1 ? taskNoun : taskNounPlural;

  return (
    <article className="border-border bg-card flex flex-col gap-3 rounded-xl border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-xs font-medium tracking-wide uppercase">
            {team.key}
          </span>
          <h2 className="text-foreground min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
            {team.name}
          </h2>
        </div>
        {team.triageEnabled ? <Badge variant="secondary">Triage</Badge> : null}
      </div>

      {team.description ? (
        <p className="text-muted-foreground line-clamp-2 text-sm leading-relaxed">
          {team.description}
        </p>
      ) : null}

      <div className="border-border text-muted-foreground mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-xs">
        <span className="flex items-center gap-1.5 tabular-nums">
          <Users aria-hidden="true" className="size-3.5" />
          {team.projectCount} {projectWord}
        </span>
        <span className="tabular-nums">
          {team.taskCount} {taskWord}
        </span>
      </div>
    </article>
  );
}
