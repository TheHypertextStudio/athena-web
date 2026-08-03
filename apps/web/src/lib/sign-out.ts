'use client';

import type { QueryClient } from '@tanstack/react-query';

import { purgeAllOutboxes } from '@/components/pwa/outbox-store';
import { purgeOfflineDocuments } from '@/components/pwa/purge-offline-documents';
import { signOut } from '@/lib/auth-client';
import { purgeAllPersistedQueryCaches } from '@/lib/query-persist';
import { clearSessionSnapshot } from '@/lib/session-snapshot';

/**
 * Drop every local trace of the current session, without touching the network or navigating.
 *
 * @remarks
 * Split out of {@link signOutAndPurge} because the two callers need very different things. An
 * explicit sign-out must also *end* the server session and leave the page; a session discovered to
 * have already ended has nothing left to end, and must not navigate on the user's behalf.
 *
 * The order matters: clear the in-memory cache first so nothing can be re-persisted from it
 * afterwards, then the offline identity snapshot (otherwise "signed out, then offline" would let the
 * shell render a workspace for someone who is not signed in), then every persisted bucket — not
 * just this user's, since the point is that no previous occupant's data survives.
 *
 * There are now four such places, not one, and they are cleared together on purpose: the query
 * buckets, the offline write queue, and the service worker's cached route documents. The last two
 * arrived with offline support, and each would otherwise let a previous occupant's data — an unsent
 * change, a rendered workspace shell — outlive their session on a shared device. Unsent changes
 * *are* discarded by this; the sync indicator is visible the whole time any exist, so signing out
 * with work still queued is a choice someone can see themselves making.
 *
 * @param queryClient - The active client, whose in-memory cache is cleared.
 */
export async function purgeLocalSessionState(queryClient: QueryClient): Promise<void> {
  queryClient.clear();
  clearSessionSnapshot();
  await Promise.all([purgeAllPersistedQueryCaches(), purgeAllOutboxes(), purgeOfflineDocuments()]);
}

/**
 * The single **explicit** sign-out path: end the session and leave nothing of it behind.
 *
 * @remarks
 * Centralized because signing out has to tear down three separate stores, and doing that correctly
 * in two places was never going to stay correct. Once the query cache is persisted to IndexedDB, a
 * sign-out that only ends the session leaves the previous person's orgs, projects and tasks readable
 * by whoever opens the browser next.
 *
 * **Only ever call this for a deliberate user action** — the account menu and the command palette's
 * "Sign out". It is emphatically not a reaction to a `401`: this function *destroys* the session,
 * so invoking it on suspicion turns a possibly-transient failure into a certain sign-out. That was
 * the exact mechanism behind the "Docket keeps asking me to sign in" bug; see
 * {@link file://./session-recovery.ts} for what a `401` does instead.
 *
 * The final step is a **full document load**, not `router.replace`. A client navigation would leave
 * the old user's React tree, provider state, and any in-flight requests alive in the same
 * JavaScript context; a real navigation guarantees none of it survives.
 *
 * @param queryClient - The active client, whose in-memory cache is cleared.
 */
export async function signOutAndPurge(queryClient: QueryClient): Promise<void> {
  try {
    await signOut();
  } finally {
    // Runs even if the sign-out request itself failed: local state must not outlive the *explicit*
    // intent to sign out.
    await purgeLocalSessionState(queryClient);
    window.location.replace('/sign-in');
  }
}
