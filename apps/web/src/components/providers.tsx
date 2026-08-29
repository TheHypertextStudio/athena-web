'use client';

import { ContextProvider } from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { type JSX, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import ActionDomainsProvider from '@/components/actions/action-domains-provider';
import { PickerOverlayProvider } from '@/components/pickers/picker-overlay';
import {
  type OutboxOwnerToken,
  captureOutboxOwner,
  isCurrentOutboxOwner,
  subscribeOutbox,
} from '@/components/pwa/outbox';
import { canQueueWrites } from '@/components/pwa/outbox-store';
import { InteractionProvider } from '@/lib/actions';
import { InteractionReceiptProvider } from '@/lib/interactions/receipt-context';
import { probeSession } from '@/lib/auth-client';
import { createQueryClient } from '@/lib/query';
import { SessionExpiredError } from '@/lib/query';
import { createUnauthorizedConfirmer } from '@/lib/session-recovery';
import { purgeLocalSessionState } from '@/lib/sign-out';

import {
  AuthenticationInterlockProvider,
  useAuthenticationInterlock,
} from './authentication-interlock';
import { InPageSearchProvider } from './in-page-search/in-page-search-provider';
import { ServiceWorkerProvider } from './service-worker-provider';

/** Props for {@link Providers}. */
export interface ProvidersProps {
  /** The application subtree wrapped by every global client provider. */
  children: ReactNode;
}

/**
 * The composed client-side providers for the Docket product app.
 *
 * @remarks
 * Wraps the tree (outermost to innermost) in:
 *
 * 1. The `@docket/ui` `ContextProvider` — the active org/Hub context, density, and accent.
 * 2. The `@docket/ui` `VocabularyProvider` — entity-noun skinning (defaults to the Hub's
 *    startup preset until an org skin is bound deeper in the tree).
 * 3. The `@docket/ui` `TooltipProvider` — one shared open/skip-delay timing for every
 *    {@link Tooltip} in the app, so icon-only controls name themselves on hover/focus
 *    consistently (the inline responsiveness the Phase A review asked for).
 * 4. TanStack Query's `QueryClientProvider` — the dynamic-data layer that backs every
 *    read/mutation hook in `@/lib/query`, so data surfaces auto-refetch on window focus
 *    and after mutations instead of needing a manual "Refresh" button.
 * 5. {@link InteractionReceiptProvider} — the app's single local receipt lifecycle for semantic,
 *    painted acknowledgement and local feedback escalation. It is deliberately separate from the
 *    action registry and sends no production observation data.
 * 6. {@link InteractionProvider} — the app's single action registry, drag record, and
 *    document-level right-click handler. Mounted exactly once, and here rather than in the
 *    authenticated shell, because "exactly one" is the whole point: two registries would mean two
 *    context menus and two answers to what a gesture does. It is inert until a surface registers
 *    an action domain — with nothing registered, a right-click resolves to no actions and the
 *    browser's own menu is deliberately left alone.
 * 7. {@link PickerOverlayProvider} — the app's one moved "edit labels on N objects" popover,
 *    mounted above {@link ActionDomainsProvider} so both the `task.label` registry action and
 *    every task list's `L` hotkey can summon it via `usePickerOverlay().open(...)`.
 * 8. {@link ActionDomainsProvider} — registers each object domain with the one registry owned by
 *    {@link InteractionProvider}; it does not mount another menu handler.
 * 9. {@link InPageSearchProvider} — routes Ctrl/Cmd+F to the active virtualized surface while
 *    leaving native browser find alone when no surface registers a target.
 * 10. {@link ServiceWorkerProvider} — registers the service worker on EVERY route, not just the
 *    authenticated shell. Offline support has to be installed before it is needed, and someone
 *    arriving at `/sign-in` is exactly who benefits from the offline page being cached already.
 *
 * All are Client Components, so this file carries the `'use client'` boundary and is
 * mounted once by the root layout. The {@link QueryClient} is created via `useState` (lazy
 * initializer) so a single, stable client survives re-renders without leaking across requests
 * — the App Router client-component pattern for TanStack Query.
 */
export function Providers({ children }: ProvidersProps): JSX.Element {
  // The global `onError` seam delegates to a handler installed by `UnauthorizedWatcher`, which lives
  // *inside* the interlock and query providers and so can reach both. The indirection is what lets a
  // 401 open the same dismissible interlock the app shell uses, instead of the hard
  // `window.location.replace` this path used to perform.
  const handleCacheError = useRef<((error: unknown) => void) | null>(null);
  const [queryClient] = useState(() =>
    createQueryClient({
      onError: (error) => {
        handleCacheError.current?.(error);
      },
    }),
  );
  return (
    <ContextProvider>
      <VocabularyProvider>
        <TooltipProvider delayDuration={400}>
          <AuthenticationInterlockProvider>
            <QueryClientProvider client={queryClient}>
              <UnauthorizedWatcher handlerRef={handleCacheError} />
              <InteractionReceiptProvider>
                <InteractionProvider>
                  <PickerOverlayProvider>
                    <ActionDomainsProvider>
                      <InPageSearchProvider>
                        <ServiceWorkerProvider>{children}</ServiceWorkerProvider>
                      </InPageSearchProvider>
                    </ActionDomainsProvider>
                  </PickerOverlayProvider>
                </InteractionProvider>
              </InteractionReceiptProvider>
            </QueryClientProvider>
          </AuthenticationInterlockProvider>
        </TooltipProvider>
      </VocabularyProvider>
    </ContextProvider>
  );
}

/** Props for {@link UnauthorizedWatcher}. */
export interface UnauthorizedWatcherProps {
  /**
   * The slot {@link Providers}' `onError` reads. Populated on mount so the query client — which is
   * created above these providers — can reach a handler that depends on them.
   */
  readonly handlerRef: { current: ((error: unknown) => void) | null };
}

/**
 * React to a `401` from any read or write by *confirming* the session before touching it.
 *
 * @remarks
 * This replaces a handler that did the opposite. Previously any `SessionExpiredError` — including one
 * from a silent background refetch, and `refetchOnWindowFocus` is on — immediately called
 * `signOutAndPurge`: Better Auth `signOut()`, then `window.location.replace('/sign-in')` with no
 * `callbackURL`. Since that *destroyed* the session cookie, a `401` that was merely transient (an API
 * cold start, a read racing the daily `session.updateAge` rotation, a proxy blip) permanently signed
 * the person out and then honestly demanded a fresh passkey ceremony. It also bypassed
 * {@link resolveSessionStatus} entirely, defeating the very distinction that module exists to draw.
 *
 * Now the `401` is treated as evidence. {@link probeSession} asks `/get-session`, and only a
 * confirmed "no session" purges local state and opens the interlock — dismissible, and carrying the
 * current path as its return target so the person keeps their place. A live session or an
 * unreachable server changes nothing: the originating query still surfaces its own inline error,
 * which is the honest outcome for one endpoint failing.
 *
 * Nothing here ever calls `signOut()`. If the session has genuinely ended there is nothing left to
 * end, and if it has not, ending it is the bug.
 *
 * Exported for `tests/components/unauthorized-watcher.test.tsx`, which pins each verdict's behavior
 * directly rather than through the whole provider stack.
 */
export function UnauthorizedWatcher({ handlerRef }: UnauthorizedWatcherProps): null {
  const queryClient = useQueryClient();
  const { requireAuthentication, reportSessionCleanupFailure } = useAuthenticationInterlock();
  const active = useRef(true);
  const cancelOwnerWait = useRef<(() => void) | null>(null);
  const confirmation = useRef<{
    readonly owner: OutboxOwnerToken | null;
    readonly confirm: ReturnType<typeof createUnauthorizedConfirmer>;
  } | null>(null);

  const completeSessionEnd = useCallback(
    async (owner: OutboxOwnerToken | null): Promise<void> => {
      if (!watcherIsActive(active)) return;
      if (owner !== null && !isCurrentOutboxOwner(owner)) return;
      const purge = await purgeLocalSessionState(queryClient, owner);
      if (!watcherIsActive(active) || purge === 'superseded') return;
      if (purge === 'failed') {
        reportSessionCleanupFailure();
        return;
      }
      requireAuthentication(`${window.location.pathname}${window.location.search}`);
    },
    [queryClient, reportSessionCleanupFailure, requireAuthentication],
  );

  const confirmBoundOwner = useCallback(
    (owner: OutboxOwnerToken): void => {
      const confirm = createUnauthorizedConfirmer(probeSession);
      confirmation.current = { owner, confirm };
      void (async () => {
        if ((await confirm()) !== 'session-ended' || !active.current) return;
        await completeSessionEnd(owner);
      })();
    },
    [completeSessionEnd],
  );

  const waitForBoundOwner = useCallback((): void => {
    if (!active.current || cancelOwnerWait.current !== null) return;
    let waiting = true;
    const isWaiting = (): boolean => waiting;
    let unsubscribe = (): void => undefined;
    const cancel = (): void => {
      if (!waiting) return;
      waiting = false;
      unsubscribe();
      if (cancelOwnerWait.current === cancel) cancelOwnerWait.current = null;
    };
    const onChange = (): void => {
      if (!waiting || !active.current) return;
      const owner = captureOutboxOwner();
      if (owner === null) return;
      cancel();
      confirmBoundOwner(owner);
    };
    unsubscribe = subscribeOutbox(onChange);
    if (!isWaiting()) {
      unsubscribe();
      return;
    }
    cancelOwnerWait.current = cancel;
    onChange();
  }, [confirmBoundOwner]);

  const onCacheError = useCallback(
    (error: unknown): void => {
      if (!(error instanceof SessionExpiredError)) return;
      const owner = captureOutboxOwner();
      if (owner !== null) cancelOwnerWait.current?.();
      if (confirmation.current === null || !sameOutboxOwner(confirmation.current.owner, owner)) {
        confirmation.current = { owner, confirm: createUnauthorizedConfirmer(probeSession) };
      }
      const confirmUnauthorized = confirmation.current.confirm;
      void (async () => {
        if ((await confirmUnauthorized()) !== 'session-ended' || !active.current) return;
        const confirmedOwner = owner;
        if (confirmedOwner === null && canQueueWrites()) {
          const reboundOwner = captureOutboxOwner();
          if (reboundOwner === null) {
            waitForBoundOwner();
            return;
          }
          confirmBoundOwner(reboundOwner);
          return;
        }
        await completeSessionEnd(confirmedOwner);
      })();
    },
    [completeSessionEnd, confirmBoundOwner, waitForBoundOwner],
  );

  useEffect(() => {
    active.current = true;
    handlerRef.current = onCacheError;
    return () => {
      active.current = false;
      cancelOwnerWait.current?.();
      cancelOwnerWait.current = null;
      confirmation.current = null;
      handlerRef.current = null;
    };
  }, [handlerRef, onCacheError]);

  return null;
}

/** Compare owner values because each capture returns a new token object. */
function sameOutboxOwner(left: OutboxOwnerToken | null, right: OutboxOwnerToken | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.userId === right.userId &&
    left.generation === right.generation &&
    left.epoch === right.epoch
  );
}

/** Read watcher liveness again after an asynchronous boundary. */
function watcherIsActive(active: Readonly<{ current: boolean }>): boolean {
  return active.current;
}
