'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuthenticationInterlock } from '@/components/authentication-interlock';
import { waitForOutboxSessionTransition } from '@/components/pwa/outbox';
import { purgeOfflineDocuments } from '@/components/pwa/purge-offline-documents';
import { useAppPathname } from '@/lib/app-location';
import { authClient } from '@/lib/auth-client';
import { purgeAllNavigationSnapshots } from '@/lib/navigation-snapshot-runtime';
import { clearSessionSnapshot, readSessionSnapshot } from '@/lib/session-snapshot';
import type { ServerSessionUser } from '@/lib/server-session';
import { resolveSessionStatus } from '@/lib/session-status';
import { useOnlineStatus } from '@/lib/use-online-status';

const SESSION_PEND_BUDGET_MS = 8_000;

/** Shared identity state for authenticated workspace and activity layouts. */
export interface AuthenticatedIdentity {
  readonly pathname: string;
  readonly session: ReturnType<typeof authClient.useSession>['data'];
  readonly isPending: boolean;
  readonly refetch: ReturnType<typeof authClient.useSession>['refetch'];
  readonly status: ReturnType<typeof resolveSessionStatus>;
  readonly online: boolean;
  readonly offlineIdentity: ReturnType<typeof readSessionSnapshot>;
  readonly userId: string | null;
  readonly identitySwitching: boolean;
}

/** Reconcile identity and clear private state before either workspace or activity can render. */
export function useAuthenticatedIdentity(
  initialSession: ServerSessionUser | null,
): AuthenticatedIdentity {
  const pathname = useAppPathname();
  const { data: session, isPending, error: sessionError, refetch } = authClient.useSession();
  const { requireAuthentication } = useAuthenticationInterlock();
  const online = useOnlineStatus();

  // A request that hangs rather than fails (captive portal) never flips `isPending`, so give the
  // pend a deadline and treat an overrun as unreachable. Reset whenever the query restarts.
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  useEffect(() => {
    if (!isPending) {
      setPendingTimedOut(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setPendingTimedOut(true);
    }, SESSION_PEND_BUDGET_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isPending]);

  const status = resolveSessionStatus({
    hasSession: Boolean(session),
    isPending,
    hasError: sessionError !== null,
    pendingTimedOut,
  });

  // Only a server-confirmed "no session" may interrupt. An unreachable server means we simply do
  // not know, and shoving a non-dismissible sign-in dialog at someone who is merely offline —
  // with a perfectly valid session — is the failure this branch exists to prevent.
  useEffect(() => {
    if (status === 'signed-out') {
      clearSessionSnapshot();
      requireAuthentication(`${pathname}${window.location.search}`);
    }
  }, [status, pathname, requireAuthentication]);

  // Read once per unreachable episode rather than on every render, so the offline shell does not
  // re-resolve identity mid-session.
  const [snapshot] = useState(() => readSessionSnapshot(Date.now()));

  // The snapshot stands in for the live session ONLY while the server is unreachable. Every other
  // status ignores it, so it can never keep a signed-out person inside the shell.
  const offlineIdentity = status === 'unreachable' ? snapshot : null;
  const userId = session?.user.id ?? initialSession?.userId ?? offlineIdentity?.userId ?? null;

  // A QueryClient key does not contain the account id. Hold private rendering when the resolved
  // identity changes, clear every account-neutral memory entry before paint, and release the next
  // account only after all persisted identity artifacts have finished deleting. The initial value
  // includes the disk snapshot so a cold B entry on a browser last used by A is gated too.
  const queryClient = useQueryClient();
  const [renderedUserId, setRenderedUserId] = useState<string | null>(
    () => snapshot?.userId ?? userId,
  );
  const identitySwitching = renderedUserId !== userId;
  useLayoutEffect(() => {
    if (!identitySwitching) return undefined;
    let current = true;
    queryClient.clear();
    clearSessionSnapshot();
    void Promise.all([
      waitForOutboxSessionTransition(),
      purgeAllNavigationSnapshots(),
      purgeOfflineDocuments(),
    ]).then(() => {
      if (current) setRenderedUserId(userId);
    });
    return () => {
      current = false;
    };
  }, [identitySwitching, queryClient, userId]);

  // Re-ask ONLY on the offline -> online edge, never on `status`.
  //
  // An earlier version refetched whenever `status === 'unreachable'`, which was a self-inflicted
  // request storm: the refetch failed, status returned to `unreachable`, and the effect fired
  // again — measured at ~2,060 requests to `/api/auth/get-session` in 15 seconds against a server
  // that was merely returning 500. It also meant `isPending` never settled, so the shell could
  // never reach a terminal state and sat on its loading treatment indefinitely.
  //
  // Better Auth's own online manager already refetches on reconnect, so this is only a backstop for
  // the captive-portal case where no `offline` event ever fired. Everything else is the explicit
  // retry control.
  const wasOnlineRef = useRef(online);
  useEffect(() => {
    const cameBackOnline = online && !wasOnlineRef.current;
    wasOnlineRef.current = online;
    if (cameBackOnline) void refetch();
  }, [online, refetch]);

  return {
    pathname,
    session,
    isPending,
    refetch,
    status,
    online,
    offlineIdentity,
    userId,
    identitySwitching,
  };
}
