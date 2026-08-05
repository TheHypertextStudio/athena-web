'use client';

/**
 * Resolve every chip in one surface with a single request.
 *
 * @remarks
 * A chip that fetched its own card would make a six-mention description cost six requests, and a
 * long document far worse. Instead each chip registers its reference with this provider, the
 * provider issues one batched query, and chips read their card out of context.
 *
 * Chips render immediately from the label their author typed, so nothing here is on the critical
 * path of *seeing* a mention — only of seeing its preview.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { MentionCard, MentionRef } from '@docket/types';
import { mentionRefKey } from '@docket/types';

import { api } from '@/lib/api';
import { apiQueryOptions, STALE, useApiQuery } from '@/lib/query';
import { queryKeys } from '@/lib/query-keys';

interface MentionHydrationValue {
  readonly cards: ReadonlyMap<string, MentionCard>;
  readonly register: (ref: MentionRef) => void;
  readonly pending: boolean;
}

const MentionHydrationContext = createContext<MentionHydrationValue | undefined>(undefined);

/** Props for {@link MentionHydrationProvider}. */
export interface MentionHydrationProviderProps {
  readonly orgId: string;
  readonly children: React.ReactNode;
}

/**
 * Collect the references rendered beneath it and resolve them in one batch.
 *
 * @returns The provider.
 */
export default function MentionHydrationProvider({
  orgId,
  children,
}: MentionHydrationProviderProps): React.JSX.Element {
  const [refs, setRefs] = useState<readonly MentionRef[]>([]);

  const register = useCallback((ref: MentionRef) => {
    setRefs((current) =>
      current.some((existing) => mentionRefKey(existing) === mentionRefKey(ref))
        ? current
        : [...current, ref],
    );
  }, []);

  // Sorted, so two surfaces holding the same references in different orders share one cache entry
  // rather than fetching the same batch twice.
  const batchKey = useMemo(() => refs.map(mentionRefKey).sort().join('|'), [refs]);

  const hydrateQ = useApiQuery(
    apiQueryOptions<{ items: MentionCard[] }>(
      queryKeys.mentionHydrate(orgId, batchKey),
      () =>
        api.v1.orgs[':orgId'].mentions.hydrate.$post({
          param: { orgId },
          json: { refs: refs.slice(0, 50) },
        }),
      'Could not load this preview.',
      { enabled: refs.length > 0, staleTime: STALE.standard },
    ),
  );

  const value = useMemo<MentionHydrationValue>(() => {
    const cards = new Map<string, MentionCard>();
    for (const card of hydrateQ.data?.items ?? []) {
      const ref: MentionRef =
        card.kind === 'entity'
          ? { kind: 'entity', entityKind: card.entityKind, entityId: card.entityId }
          : { kind: 'external', url: card.url };
      cards.set(mentionRefKey(ref), card);
    }
    return { cards, register, pending: hydrateQ.isPending && refs.length > 0 };
  }, [hydrateQ.data, hydrateQ.isPending, refs.length, register]);

  return (
    <MentionHydrationContext.Provider value={value}>{children}</MentionHydrationContext.Provider>
  );
}

/**
 * Read one reference's resolved card, registering it for the next batch if it is new.
 *
 * @param ref - The reference this chip renders.
 * @returns The card once resolved, and whether the batch is still in flight.
 */
export function useMentionCard(ref: MentionRef): {
  card: MentionCard | undefined;
  pending: boolean;
} {
  const context = useContext(MentionHydrationContext);
  const key = mentionRefKey(ref);

  // Registering during render would be a side effect in the wrong phase; chips call this from an
  // effect via the returned `register`. A surface with no provider simply shows no preview, which
  // is the right behavior for a chip rendered outside a document.
  return {
    card: context?.cards.get(key),
    pending: context?.pending ?? false,
  };
}

/** Register a reference with the surrounding batch. Safe to call when there is no provider. */
export function useRegisterMention(): (ref: MentionRef) => void {
  const context = useContext(MentionHydrationContext);
  return context?.register ?? noop;
}

function noop(): void {
  // A chip outside a hydration provider renders from its stored label and never previews.
}
