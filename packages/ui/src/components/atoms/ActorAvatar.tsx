'use client';

/**
 * `@docket/ui` — the actor avatar atom.
 *
 * @remarks
 * Renders an org-scoped actor (the "who" behind any assignment) over the {@link Avatar}
 * primitive, distinguishing the three actor kinds by *shape* and *ring rule* so a human, an
 * agent, and a team are visually separable at a glance:
 *
 * - `human` — fully rounded; a muted ring only.
 * - `agent` — squircle (rounded, not circular) with the {@link Sparkles} accent ring,
 *   marking automated actors.
 * - `team` — rounded-square; a dashed ring, signalling a collective rather than an
 *   individual.
 *
 * All colors come from semantic tokens (`ring-border`, `ring-primary`, `bg-muted`) — never
 * hardcoded.
 */
import * as React from 'react';

import { Sparkles } from '../../icons';
import { cn } from '../../lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '../../primitives';

/** The actor kinds, mirroring `ActorOut.kind` in `@docket/types`. */
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

/** Per-kind shape + ring classes that make each actor kind visually distinct. */
const KIND_SHAPE_CLASS: Record<ActorKind, string> = {
  human: 'rounded-full ring-1 ring-border',
  agent: 'rounded-lg ring-1 ring-primary',
  team: 'rounded-md ring-1 ring-dashed ring-border',
};

/** Props for {@link ActorAvatar}. */
export interface ActorAvatarProps {
  /** The actor kind; selects the shape and ring rule. */
  kind: ActorKind;
  /** The actor's display name; used for the accessible label and initials fallback. */
  name: string;
  /** Optional avatar image URL. */
  avatarUrl?: string | null;
  /** Size in pixels for the square avatar box. Defaults to `24`. */
  size?: number;
  /** Extra classes merged onto the avatar box. */
  className?: string;
}

/**
 * An actor avatar whose shape and ring encode the actor's {@link ActorKind}.
 *
 * @remarks
 * Agents additionally carry a small {@link Sparkles} badge so automated actors read as
 * non-human even without color. The element is labelled with the actor's name.
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
          className={cn('bg-muted text-[0.625rem] font-medium', KIND_SHAPE_CLASS[kind])}
        >
          {initialsOf(name)}
        </AvatarFallback>
      </Avatar>
      {kind === 'agent' ? (
        <Sparkles
          aria-hidden="true"
          className="bg-background text-primary absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
        />
      ) : null}
    </span>
  );
}
