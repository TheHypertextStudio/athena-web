'use client';

/**
 * The People section of a team page.
 *
 * @remarks
 * Name, org-level job title, standing on this team, and how much open team work each person is
 * already carrying.
 *
 * The row renders no signal of whether someone holds a Docket account, and that is a contract
 * rather than an omission: a nonprofit's volunteers are tracked here exactly like its staff, and a
 * grey name or a "no account" chip would be the moment the product started treating them as
 * lesser. `docs/engineering/specs/people.md` §3 is the exhaustive list of places account-holders
 * and account-less people are allowed to differ, and a roster is not on it.
 *
 * The load figure is observed, never declared. Docket stores no allocation percentage on a
 * membership, because a number someone has to maintain drifts out of date silently while still
 * looking authoritative — and "how much is this person holding" is answerable from task state
 * without anyone maintaining anything.
 */
import type { TeamMemberOut, TeamMemberRole } from '../../lib/contracts/team';
import { ActorAvatar, EmptyState } from '@docket/ui/components';
import { Users } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Badge, Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** How each team role is labelled. Only a manager is worth calling out on the row. */
const ROLE_LABEL: Record<TeamMemberRole, string | null> = {
  manager: 'Manager',
  member: null,
  guest: 'Guest',
};

/** Props for {@link TeamPeople}. */
export interface TeamPeopleProps {
  /** The team's members, already ordered by name. */
  members: readonly TeamMemberOut[];
  /** The plural task noun from the workspace vocabulary. */
  taskNounPlural: string;
  /** Extra classes merged onto the list frame. */
  className?: string;
}

/**
 * The team roster.
 *
 * @param props - The {@link TeamPeopleProps}.
 * @returns the rendered roster.
 */
export function TeamPeople({ members, taskNounPlural, className }: TeamPeopleProps): JSX.Element {
  if (members.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Nobody is on this team yet"
        body="Once someone is added to this team, they show up here alongside how much open work they're carrying."
        className={className}
      />
    );
  }

  return (
    <ul
      aria-label="Team members"
      className={cn('bg-surface-container-low flex list-none flex-col rounded-xl p-2', className)}
    >
      {members.map((member) => {
        const roleLabel = ROLE_LABEL[member.role];
        return (
          <li
            key={member.actorId}
            className="hover:bg-surface-container flex min-h-14 items-center gap-3 rounded-lg px-2 transition-colors motion-reduce:transition-none"
          >
            <ActorAvatar
              kind="human"
              name={member.displayName}
              avatarUrl={member.avatar}
              size={32}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-on-surface text-body-medium line-clamp-1">
                {member.displayName}
              </span>
              {/* A title is the one place a volunteer's standing in the organization is often
                  recorded at all, so it gets the subtitle slot rather than a tooltip. */}
              {member.title ? (
                <span className="text-on-surface-variant text-body-small line-clamp-1">
                  {member.title}
                </span>
              ) : null}
            </div>
            {roleLabel ? (
              <Badge variant="secondary" className="shrink-0">
                {roleLabel}
              </Badge>
            ) : null}
            <span className="text-on-surface-variant text-label-small w-24 shrink-0 text-right tabular-nums">
              {member.openTaskCount > 0 ? (
                <>
                  {member.openTaskCount} open
                  <span className="sr-only"> {taskNounPlural}</span>
                </>
              ) : (
                '—'
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Loading placeholder for the roster. */
export function TeamPeopleSkeleton(): JSX.Element {
  // placeholder: who is on this team, their titles, roles, and current load.
  return (
    <div aria-hidden="true" className="bg-surface-container-low flex flex-col gap-2 rounded-xl p-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

export default TeamPeople;
