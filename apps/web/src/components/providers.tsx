'use client';

import { ContextProvider } from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ActionDomainsProvider from '@/components/actions/action-domains-provider';
import { PickerOverlayProvider } from '@/components/pickers/picker-overlay';
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
  const { requireAuthentication } = useAuthenticationInterlock();

  // One confirmer for the component's lifetime, so a burst of simultaneous 401s from several mounted
  // surfaces collapses into a single `/get-session` question.
  const confirmUnauthorized = useMemo(() => createUnauthorizedConfirmer(probeSession), []);

  const onCacheError = useCallback(
    (error: unknown): void => {
      if (!(error instanceof SessionExpiredError)) return;
      void (async () => {
        if ((await confirmUnauthorized()) !== 'session-ended') return;
        await purgeLocalSessionState(queryClient);
        requireAuthentication(`${window.location.pathname}${window.location.search}`);
      })();
    },
    [confirmUnauthorized, queryClient, requireAuthentication],
  );

  useEffect(() => {
    handlerRef.current = onCacheError;
    return () => {
      handlerRef.current = null;
    };
  }, [handlerRef, onCacheError]);

  return null;
}
