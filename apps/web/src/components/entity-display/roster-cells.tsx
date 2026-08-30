'use client';

/**
 * `entity-display/roster-cells` — the small cells every roster repeats.
 *
 * @remarks
 * A rolled-up child count and an actor's avatar-plus-name are the two things a roster row or card
 * shows over and over, and they were written inline everywhere that needed them: twice in the
 * Programs card, three times in the Teams roster, once in the work-view list. Each copy agreed on
 * the shape and disagreed on some detail — the gap, whether the number was tabular, whether the
 * noun reached a screen reader at all.
 *
 * Both take their type role from the caller, because a dense row and a card sit at different
 * sizes and neither should have to fight the other for one shared default.
 */
import type { WorkViewActor } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { Text, type TextTone, type TypeToken } from '@docket/ui/primitives';
import type { ComponentType, JSX } from 'react';

/** Props for {@link WorkCount}. */
export interface WorkCountProps {
  /** The glyph naming what is being counted. */
  readonly icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** The rolled-up count. */
  readonly value: number;
  /** The org-skinned noun, already agreeing with {@link value}, for the accessible name. */
  readonly noun: string;
  /** The type role for the surface this sits on. */
  readonly token: TypeToken;
  /** The colour role. Defaults to `muted`, which is what a roster's metadata takes. */
  readonly tone?: TextTone | undefined;
}

/**
 * One rolled-up child count: a glyph, an aligned number, and the noun a screen reader hears.
 *
 * @remarks
 * The number is tabular so a column of them does not jitter, and the noun is `sr-only` because
 * the glyph already says it to anyone who can see it.
 *
 * @param props - The {@link WorkCountProps}.
 */
export function WorkCount({
  icon: Icon,
  value,
  noun,
  token,
  tone = 'muted',
}: WorkCountProps): JSX.Element {
  return (
    <Text token={token} tone={tone} numeric className="flex items-center gap-1.5">
      <Icon aria-hidden className="size-4" />
      {value}
      <span className="sr-only">{noun}</span>
    </Text>
  );
}

/** Props for {@link ActorName}. */
export interface ActorNameProps {
  /** The resolved actor. Callers that may have none render nothing rather than a placeholder. */
  readonly actor: WorkViewActor;
  /** The type role for the surface this sits on. */
  readonly token: TypeToken;
  /** The colour role. Defaults to `muted`. */
  readonly tone?: TextTone | undefined;
}

/**
 * An actor's avatar and display name.
 *
 * @param props - The {@link ActorNameProps}.
 */
export function ActorName({ actor, token, tone = 'muted' }: ActorNameProps): JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ActorAvatar kind={actor.kind} name={actor.displayName} avatarUrl={actor.avatar} size={20} />
      <Text token={token} tone={tone} truncate>
        {actor.displayName}
      </Text>
    </span>
  );
}
