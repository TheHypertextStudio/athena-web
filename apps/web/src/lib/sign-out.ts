'use client';

import type { QueryClient } from '@tanstack/react-query';

import { signOut } from '@/lib/auth-client';
import { purgeAllPersistedQueryCaches } from '@/lib/query-persist';
import { clearSessionSnapshot } from '@/lib/session-snapshot';

/**
 * The single sign-out path: end the session and leave nothing of it behind.
 *
 * @remarks
 * Centralized because signing out now has to tear down three separate stores, and doing that
 * correctly in two places was never going to stay correct. Once the query cache is persisted to
 * IndexedDB, a sign-out that only ends the session leaves the previous person's orgs, projects and
 * tasks readable by whoever opens the browser next.
 *
 * The order matters:
 *
 * 1. End the server session first, so the credential is dead before anything else is touched.
 * 2. Clear the in-memory cache, so nothing can be re-persisted from it afterwards.
 * 3. Clear the offline identity snapshot — otherwise "sign out, then go offline" would let the
 *    shell render a workspace for someone who has actually signed out.
 * 4. Purge every persisted cache bucket, not just this user's.
 * 5. Only then navigate.
 *
 * The last step is a **full document load**, not `router.replace`. A client navigation would leave
 * the old user's React tree, provider state, and any in-flight requests alive in the same
 * JavaScript context; a real navigation guarantees none of it survives.
 *
 * @param queryClient - The active client, whose in-memory cache is cleared.
 */
export async function signOutAndPurge(queryClient: QueryClient): Promise<void> {
  try {
    await signOut();
  } finally {
    // Runs even if the sign-out request itself failed: local state must not outlive the intent to
    // sign out, and the interlock will handle the session either way.
    queryClient.clear();
    clearSessionSnapshot();
    await purgeAllPersistedQueryCaches();
    window.location.replace('/sign-in');
  }
}
