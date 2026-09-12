/**
 * `components/plan-canvas/plan-actors` — resolving the people a plan names for its cards.
 *
 * @remarks
 * The plan document stores actor ids. The cards draw an avatar and a name, so the route turns the
 * organisation's member list, which it already fetches for the pickers, into a resolver the
 * projection calls per field. Members are people; an id the list does not know resolves to null
 * and the card shows nothing for that field.
 */
import { useCallback } from 'react';

import type { PlanActor } from './plan-nodes';

/** The member fields the resolver reads. */
export interface PlanMemberLike {
  readonly actorId: string;
  readonly displayName: string;
  readonly avatar?: string | null | undefined;
}

/**
 * A stable resolver from actor id to {@link PlanActor} over the given members.
 *
 * @param members - The organisation's members, or undefined while they load.
 * @returns a resolver that returns null for an id the members do not include.
 */
export function usePlanActorResolver(
  members: readonly PlanMemberLike[] | undefined,
): (actorId: string) => PlanActor | null {
  return useCallback(
    (actorId: string): PlanActor | null => {
      const member = members?.find((candidate) => candidate.actorId === actorId);
      return member === undefined
        ? null
        : { kind: 'human', name: member.displayName, avatarUrl: member.avatar ?? null };
    },
    [members],
  );
}
