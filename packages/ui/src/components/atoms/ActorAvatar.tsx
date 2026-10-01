'use client';

/**
 * `@docket/ui` — the actor avatar atom.
 *
 * @remarks
 * Renders an org-scoped actor (the "who" behind any assignment) over the {@link Avatar}
 * primitive, distinguishing the three actor kinds by shape and fill so a human, an
 * agent, and a team are visually separable at a glance:
 *
 * - `human` — fully rounded with a neutral fill.
 * - `agent` — rounded-square with a primary-container fill.
 * - `team` — rounded-square with a secondary-container fill.
 *
 * All colors come from semantic tokens.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '../../primitives';

/** The actor kinds, mirroring `ActorOut.kind` in `domain packages`. */
export type ActorKind = 'human' | 'agent' | 'team';

/** Compute up-to-two-letter initials from a display name for the avatar fallback. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words.at(0);
  if (!first) return '?';
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  const last = words.at(-1);
  const firstChar = first.at(0);
  const lastChar = last?.at(0);
  /* v8 ignore start -- unreachable: past the length checks `words` has >= 2 non-empty entries, so these only narrow noUncheckedIndexedAccess. */
  if (last === undefined || firstChar === undefined || lastChar === undefined)
    return first.slice(0, 2).toUpperCase();
  /* v8 ignore stop */
  return (firstChar + lastChar).toUpperCase();
}

/** Per-kind shape classes that make each actor kind visually distinct. */
const KIND_SHAPE_CLASS: Record<ActorKind, string> = {
  human: 'rounded-full',
  agent: 'rounded-lg',
  team: 'rounded-md',
};

/** Fill gives each kind an identity without a decorative badge or thin outline. */
const KIND_TONE_CLASS: Record<ActorKind, string> = {
  human: 'bg-surface-container-high text-on-surface-variant',
  agent: 'bg-primary-container text-on-primary-container',
  team: 'bg-secondary-container text-on-secondary-container',
};

/** Props for {@link ActorAvatar}. */
export interface ActorAvatarProps {
  /** The actor kind; selects the shape and ring rule. */
  kind: ActorKind;
  /** The actor's display name; used for the accessible label and initials fallback. */
  name: string;
  /** Optional avatar image URL. */
  avatarUrl?: string | null | undefined;
  /** Size in pixels for the square avatar box. Defaults to `24`. */
  size?: number | undefined;
  /** Extra classes merged onto the avatar box. */
  className?: string | undefined;
}

/**
 * An actor avatar whose shape and fill encode the actor's {@link ActorKind}.
 *
 * @remarks
 * The element is labelled with the actor's name.
 *
 * @example
 * ```tsx
 * <ActorAvatar kind="agent" name="Triage Bot" />
 * ```
 */
export function ActorAvatar({
  kind,
  name,
  avatarUrl,
  size = 24,
  className,
}: ActorAvatarProps): React.JSX.Element {
  const dimension = { height: size, width: size };
  return (
    <span className="relative inline-flex" data-actor-kind={kind}>
      <Avatar
        aria-label={name}
        title={name}
        style={dimension}
        className={cn('h-auto w-auto overflow-hidden', KIND_SHAPE_CLASS[kind], className)}
      >
        {avatarUrl ? (
          <AvatarImage src={avatarUrl} alt={name} className={KIND_SHAPE_CLASS[kind]} />
        ) : null}
        <AvatarFallback
          className={cn('text-label-small', KIND_SHAPE_CLASS[kind], KIND_TONE_CLASS[kind])}
        >
          {initialsOf(name)}
        </AvatarFallback>
      </Avatar>
    </span>
  );
}
