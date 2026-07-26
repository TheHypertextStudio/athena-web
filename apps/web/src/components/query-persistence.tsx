'use client';

import { useQueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { useEffect } from 'react';

import {
  PERSIST_MAX_AGE_MS,
  canPersistQueries,
  createQueryPersister,
  persistKeyFor,
} from '@/lib/query-persist';

/**
 * Headless: restores the persisted query cache and keeps it written.
 *
 * @remarks
 * Mounted by the app shell inside the authenticated branch rather than wrapped around the whole
 * tree. `PersistQueryClientProvider` cannot be used here — `providers.tsx` is shared with the auth,
 * marketing and onboarding routes and already *is* the `QueryClientProvider`, so the imperative
 * `persistQueryClient` is the right seam.
 *
 * The `userId` it keys on comes from the live session when there is one and from the offline
 * identity snapshot when there is not. That is what makes an offline cold start work at all: the
 * cache bucket has to be chosen before the network can say who is signed in, and the snapshot is
 * the only synchronous source of that answer.
 *
 * Restoration is asynchronous and lands after first paint, so an offline cold start shows empty
 * lists for a beat and then fills in — acceptable, since the offline banner is already explaining
 * why the data may be stale.
 */
export function QueryPersistence({ userId }: { readonly userId: string | null }): null {
  const queryClient = useQueryClient();

  useEffect(() => {
    // No identity means no bucket to key on, and no IndexedDB means nowhere to put it. Either
    // way the app runs normally, just without anything cached for the next offline launch.
    if (!userId || !canPersistQueries()) return undefined;

    const [unsubscribe, restored] = persistQueryClient({
      queryClient,
      persister: createQueryPersister(userId),
      maxAge: PERSIST_MAX_AGE_MS,
      // Both halves matter. The user id makes a bucket written by another account unrestorable
      // even if the key were somehow reached; the storage key makes a deploy that changed response
      // shapes drop the old cache rather than rehydrate data the new code cannot read.
      buster: `${persistKeyFor(userId)}:v1`,
      dehydrateOptions: {
        // Only successful reads are worth keeping. Persisting an error state would replay a failure
        // that has probably already resolved, and persisting a pending one is meaningless.
        shouldDehydrateQuery: (query) => query.state.status === 'success',
        // Never, under any circumstances. A persisted mutation is an offline write queue by another
        // name — a write that survives a reload and fires later against changed server state.
        shouldDehydrateMutation: () => false,
      },
    });

    void restored;
    return unsubscribe;
  }, [queryClient, userId]);

  return null;
}
