'use client';

import type { QueryClient } from '@tanstack/react-query';

import {
  type OutboxOwnerToken,
  captureOutboxOwner,
  restoreOutboxUserAfterFailedSignOut,
  withOutboxSessionTransition,
} from '@/components/pwa/outbox';
import {
  commitOutboxSuspension,
  purgeAllOutboxes,
  purgeOutboxesForOwner,
  rollbackOutboxSuspension,
  suspendOutboxesForOwner,
} from '@/components/pwa/outbox-store';
import { purgeOfflineDocuments } from '@/components/pwa/purge-offline-documents';
import { signOut } from '@/lib/auth-client';
import { purgeAllNavigationSnapshots } from '@/lib/navigation-snapshot-runtime';
import { clearSessionSnapshot } from '@/lib/session-snapshot';

/** Explicit sign-out ended or changed the session but could not finish browser-data cleanup. */
export class SignOutCleanupError extends Error {
  constructor() {
    super('Could not finish sign-out cleanup safely');
    this.name = 'SignOutCleanupError';
  }
}

/** Clear session-bound local state after the durable outbox epoch has already been revoked. */
async function clearRevokedLocalSessionState(queryClient: QueryClient): Promise<void> {
  queryClient.clear();
  clearSessionSnapshot();
  await Promise.all([purgeAllNavigationSnapshots(), purgeOfflineDocuments()]);
}

/** Revoke durable data for an exact owner, or every queue before an owner has bound. */
async function revokeOutboxSession(owner: OutboxOwnerToken | null): Promise<boolean> {
  if (owner !== null && owner.epoch !== null) {
    return purgeOutboxesForOwner({ ...owner, epoch: owner.epoch });
  }
  return purgeAllOutboxes();
}

/** Retry the irreversible durable marker before any private browser state can be cleared. */
async function commitSuspensionWithRetry(
  suspension: Parameters<typeof commitOutboxSuspension>[0],
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await commitOutboxSuspension(suspension)) return true;
  }
  return false;
}

/** Outcome of clearing a server-ended session from this browser. */
export type LocalSessionPurgeResult = 'cleared' | 'superseded' | 'failed';

/**
 * Revoke the offline queue, then drop every local trace of a session that the server ended.
 *
 * @remarks
 * The durable outbox epoch is the authority. This function leaves the in-memory owner, query cache,
 * session snapshot, and other offline stores untouched when that revocation fails. A queued replay
 * can then reach this path again after the drain interval instead of being hidden locally while it
 * remains valid in storage.
 *
 * Explicit sign-out performs the same revocation itself before it starts the network request, so it
 * calls the post-revocation cleanup directly and does not bump the epoch twice.
 *
 * @param queryClient - The active client, whose in-memory cache is cleared after revocation.
 * @param owner - The account generation whose confirmed session end authorized this purge.
 * @returns Whether durable queue revocation and the following local cleanup completed.
 */
export async function purgeLocalSessionState(
  queryClient: QueryClient,
  owner: OutboxOwnerToken | null,
): Promise<LocalSessionPurgeResult> {
  const transition = await withOutboxSessionTransition(
    owner,
    async (invalidateOwner, replacementRequested) => {
      if (!(await revokeOutboxSession(owner))) return false;
      invalidateOwner();
      if (replacementRequested()) return true;
      await clearRevokedLocalSessionState(queryClient);
      return true;
    },
  );
  if (transition.status === 'stale' || transition.replacementRequested) return 'superseded';
  return transition.value ? 'cleared' : 'failed';
}

/**
 * The single **explicit** sign-out path: end the session and leave nothing of it behind.
 *
 * @remarks
 * Centralized because signing out has to tear down three separate stores, and doing that correctly
 * in two places was never going to stay correct. Once entity snapshots persist to IndexedDB, a
 * sign-out that only ends the session leaves the previous person's recently opened work readable
 * by whoever opens the browser next.
 *
 * The durable outbox purge runs first. Its exclusive barrier waits for any locked queue transition,
 * stores the new revocation epoch, and announces the purge to peers. A failure leaves every runtime
 * and the network session untouched. Once revocation succeeds, this tab invalidates its local owner
 * before the network sign-out can begin.
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
 * @param expectedUserId - The account rendered by the control that started sign-out.
 */
export async function signOutAndPurge(
  queryClient: QueryClient,
  expectedUserId: string,
): Promise<void> {
  const owner = captureOutboxOwner();
  if (owner?.userId !== expectedUserId) {
    throw new Error('Could not finish sign-out safely');
  }
  const transition = await withOutboxSessionTransition(
    owner,
    async (invalidateOwner, replacementRequested) => {
      if (owner.epoch === null) return 'revocation-failed' as const;
      const suspension = await suspendOutboxesForOwner({ ...owner, epoch: owner.epoch });
      if (suspension === null) return 'revocation-failed' as const;
      invalidateOwner();
      const outcome = await signOut(expectedUserId);
      if (outcome === 'failed' && !replacementRequested()) {
        return (await rollbackOutboxSuspension(suspension))
          ? ('failed' as const)
          : ('rollback-failed' as const);
      }
      const committed = await commitSuspensionWithRetry(suspension);
      if (outcome === 'signed-out' && !replacementRequested() && !committed) {
        return 'commit-failed' as const;
      }
      if (outcome === 'signed-out' && !replacementRequested()) {
        await clearRevokedLocalSessionState(queryClient);
      }
      return outcome;
    },
  );
  if (transition.status !== 'completed' || transition.value === 'revocation-failed') {
    throw new Error('Could not finish sign-out safely');
  }
  if (transition.value === 'rollback-failed' || transition.value === 'commit-failed') {
    throw new SignOutCleanupError();
  }
  if (transition.replacementRequested || transition.value === 'owner-changed') return;
  if (transition.value === 'failed') {
    const restored = await restoreOutboxUserAfterFailedSignOut(expectedUserId);
    if (restored === 'superseded') return;
    if (restored === 'failed') throw new SignOutCleanupError();
    throw new Error('Could not finish sign-out safely');
  }
  window.location.replace('/sign-in');
}
