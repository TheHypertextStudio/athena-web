'use client';

/**
 * One row of the workspace People roster.
 *
 * @remarks
 * **There is exactly one row component, and it takes no account-presence input.** Every person a
 * workspace tracks renders through this — the founder who signs in every morning and the weekend
 * volunteer who has never heard of Docket — with the same avatar treatment, the same text tone,
 * the same role chip and the same destination. The component literally cannot render them
 * differently: `MemberOut.userId` is never read here, so there is no branch to drift.
 *
 * That is not an accident of implementation, it is the requirement (ENT-46 / ENT-47). A badge
 * reading "no account", a muted name, or a disabled row would tell a volunteer they are a lesser
 * participant in an organization where they may be doing the most work.
 *
 * The name is a real `<a href>` rather than a click handler on the row, per the interaction
 * contract: it is keyboard- and middle-click-operable for free, and it reports `cursor-pointer`
 * on its own without the row having to claim to be a button.
 */
import { ActorAvatar } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import { Badge, Text } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

/** One person as the roster renders them. */
export interface PersonRowModel {
  /** The person's org-scoped Actor id — their identity everywhere in the workspace. */
  readonly actorId: string;
  /** The person's name as this workspace shows it. */
  readonly displayName: string;
  /** Their avatar image, when they have one. */
  readonly avatar?: string | null;
  /** Their participation status. */
  readonly status: 'active' | 'suspended';
  /** The plain-language name of the role they hold, or null when they hold none. */
  readonly roleName: string | null;
}

/** Props for {@link PersonRow}. */
export interface PersonRowProps {
  /** The person to render. */
  readonly person: PersonRowModel;
  /** Where the person's profile lives. */
  readonly href: string;
}

/**
 * A single person row: avatar, name, role, and status.
 *
 * @param props - The {@link PersonRowProps}.
 * @returns the rendered roster row.
 */
export function PersonRow({ person, href }: PersonRowProps): JSX.Element {
  return (
    <li
      data-person-row={person.actorId}
      className="hover:bg-surface-container-high flex min-h-14 items-center gap-3 px-4 py-2 transition-colors"
    >
      <ActorAvatar kind="human" name={person.displayName} avatarUrl={person.avatar} size={32} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={href}
          className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2"
        >
          <Text as="span" token="body-medium" truncate>
            {person.displayName}
          </Text>
        </Link>
      </div>
      {person.roleName ? (
        <Text as="span" token="body-small" tone="muted" className="shrink-0">
          {person.roleName}
        </Text>
      ) : null}
      {/* Suspension is a state of participation, not of identity — it is the one thing a row
          reports about a person beyond who they are, and it applies identically to both kinds. */}
      <span className={cn('flex w-24 shrink-0 justify-end')}>
        {person.status === 'suspended' ? <Badge variant="secondary">Suspended</Badge> : null}
      </span>
    </li>
  );
}
