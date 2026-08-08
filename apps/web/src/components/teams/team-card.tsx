'use client';

/**
 * `teams` — one team as a card, the Teams hub's default layout.
 *
 * @remarks
 * Cards are the default rather than the alternative because a team is one of the few objects in
 * Docket a person recognizes rather than reads. A roster of teams is short, it changes slowly, and
 * the thing someone wants from it is "which one is mine" — answered faster by a shape and a color
 * than by a name in row four. The list layout stays available in the Display menu for when someone
 * wants to compare counts down a column, which is the one job rows genuinely do better.
 *
 * The card answers, in order: which team is this, what is it for, who is on it, and how much is it
 * carrying. The counts are last deliberately — they are the reason to open the page, not a
 * substitute for it.
 */
import type { EntityDisplayOut, TeamOut } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { FolderKanban, ListChecks } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { TeamCover } from '@/components/teams/team-cover';

/** One member's identity, as much of it as a card needs. */
export interface TeamCardMember {
  actorId: string;
  displayName: string;
  avatar: string | null;
}

/** The view-model behind one team card. */
export interface TeamCardModel {
  team: TeamOut;
  display: EntityDisplayOut;
  members: readonly TeamCardMember[];
  projectCount: number;
  taskCount: number;
}

/** Props for {@link TeamCard}. */
export interface TeamCardProps extends TeamCardModel {
  /** The team detail route this card opens. */
  href: string;
  /** Singular/plural nouns for the project count, from the workspace vocabulary. */
  projectNoun: string;
  projectNounPlural: string;
  /** Singular/plural nouns for the task count. */
  taskNoun: string;
  taskNounPlural: string;
}

/** How many avatars are shown before the rest collapse into a count. */
const AVATAR_LIMIT = 5;

/**
 * One team card.
 *
 * @param props - The {@link TeamCardProps}.
 * @returns the rendered card.
 */
export function TeamCard({
  team,
  display,
  members,
  projectCount,
  taskCount,
  href,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
}: TeamCardProps): JSX.Element {
  const shown = members.slice(0, AVATAR_LIMIT);
  const overflow = members.length - shown.length;
  const projectWord = projectCount === 1 ? projectNoun : projectNounPlural;
  const taskWord = taskCount === 1 ? taskNoun : taskNounPlural;

  return (
    <Link
      href={href}
      aria-label={`${team.key} ${team.name}`}
      className={cn(
        'group bg-surface-container-low focus-visible:ring-ring relative flex flex-col',
        'overflow-hidden rounded-xl transition-colors outline-none',
        'hover:bg-surface-container focus-visible:ring-2',
        'motion-reduce:transition-none',
      )}
    >
      <TeamCover display={display} teamName={team.name} className="h-20 w-full" />

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        {/* The glyph straddles the cover's lower edge, so the identity reads as one unit rather
            than as a picture with a caption under it. No Triage badge here: triage is on for every
            team by default, so a chip that is always present says nothing and costs a corner. It
            belongs on the team page, where it is a setting someone can act on. */}
        <div className="-mt-9 flex items-end">
          <span className="ring-surface-container-low group-hover:ring-surface rounded-full ring-4 transition-[--tw-ring-color] motion-reduce:transition-none">
            <EntityIconGlyph
              iconKey={display.iconKey}
              colorKey={display.colorKey}
              customColor={display.customColor}
              size={40}
            />
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="text-on-surface text-title-small line-clamp-1">{team.name}</h3>
            <span className="text-on-surface-variant bg-surface-container-high text-label-small shrink-0 rounded px-1.5 py-0.5 font-mono">
              {team.key}
            </span>
          </div>
          {/* The tagline is the team's purpose in one line. A team without one gets nothing here
              rather than filler, because invented copy would be worse than a shorter card. */}
          {team.summary ? (
            <p className="text-on-surface-variant text-body-small line-clamp-2">{team.summary}</p>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          {members.length > 0 ? (
            <div className="flex items-center">
              {shown.map((member) => (
                <span
                  key={member.actorId}
                  className="ring-surface-container-low group-hover:ring-surface -ml-1.5 rounded-full ring-2 transition-[--tw-ring-color] first:ml-0 motion-reduce:transition-none"
                >
                  <ActorAvatar
                    kind="human"
                    name={member.displayName}
                    avatarUrl={member.avatar}
                    size={22}
                  />
                </span>
              ))}
              {overflow > 0 ? (
                <span className="text-on-surface-variant text-label-small ml-1.5 tabular-nums">
                  +{overflow}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-on-surface-variant text-label-small">No members yet</span>
          )}

          <div className="text-on-surface-variant text-label-small flex shrink-0 items-center gap-3 tabular-nums">
            <span className="flex items-center gap-1">
              <FolderKanban aria-hidden="true" className="size-3.5" />
              {projectCount}
              <span className="sr-only">{projectWord}</span>
            </span>
            <span className="flex items-center gap-1">
              <ListChecks aria-hidden="true" className="size-3.5" />
              {taskCount}
              <span className="sr-only">{taskWord}</span>
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

/** The card grid's loading placeholder. */
export function TeamCardsSkeleton(): JSX.Element {
  // placeholder: how many teams the workspace has, and each one's cover, name, roster and counts.
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-52 w-full rounded-xl" />
      ))}
    </div>
  );
}

export default TeamCard;
