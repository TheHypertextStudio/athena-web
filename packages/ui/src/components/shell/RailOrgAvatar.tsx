'use client';

/**
 * `@docket/ui` — an org avatar button for the {@link GlobalRail}.
 *
 * @remarks
 * Renders one org as a circular {@link Avatar} (image with initials fallback) wrapped in a
 * button. The active org gets a ring tinted with its deterministic accent from
 * `getOrgAccent`, so the bound org is visually unambiguous in the rail. Selecting the
 * avatar rebinds the active context.
 */
import * as React from 'react';

import { getOrgAccent } from '../../lib/org-accent';
import { cn } from '../../lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '../../primitives';

/** Compute up-to-two-letter initials from an org name for the avatar fallback. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words.at(0);
  if (!first) return '?';
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  const last = words.at(-1);
  const firstChar = first.at(0);
  const lastChar = last?.at(0);
  /* v8 ignore start -- unreachable: `words` has >= 2 non-empty entries here, so these only narrow noUncheckedIndexedAccess. */
  if (last === undefined || firstChar === undefined || lastChar === undefined)
    return first.slice(0, 2).toUpperCase();
  /* v8 ignore stop */
  return (firstChar + lastChar).toUpperCase();
}

/** Props for {@link RailOrgAvatar}. */
export interface RailOrgAvatarProps {
  /** The org's id; drives both the accent ring and the rebind target. */
  orgId: string;
  /** The org's display name; used for the label and initials fallback. */
  name: string;
  /** Optional avatar image URL. */
  avatarUrl?: string | null;
  /** Whether this org is the active context (renders the accent ring). */
  active?: boolean;
  /** Invoked with the org id when the avatar is selected. */
  onSelect: (orgId: string) => void;
}

/**
 * An org avatar button rendered in the {@link GlobalRail}.
 *
 * @remarks
 * When `active`, an accent-tinted ring (the org's `getOrgAccent` color, applied via the
 * `--org-accent` CSS variable on this element) surrounds the avatar.
 */
export function RailOrgAvatar({
  orgId,
  name,
  avatarUrl,
  active = false,
  onSelect,
}: RailOrgAvatarProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={name}
      aria-current={active ? 'true' : undefined}
      data-active={active ? '' : undefined}
      title={name}
      onClick={() => {
        onSelect(orgId);
      }}
      style={{ '--org-accent': getOrgAccent(orgId) } as React.CSSProperties}
      className={cn(
        'focus-visible:ring-ring rounded-full outline-none transition-shadow focus-visible:ring-2',
        active && 'ring-offset-background ring-2 ring-offset-2',
      )}
    >
      <Avatar
        className={cn('h-9 w-9', active && 'ring-2')}
        style={
          active ? ({ '--tw-ring-color': 'var(--org-accent)' } as React.CSSProperties) : undefined
        }
      >
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
        <AvatarFallback className="text-xs font-medium">{initialsOf(name)}</AvatarFallback>
      </Avatar>
    </button>
  );
}
