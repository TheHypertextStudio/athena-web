'use client';

import { ContextProvider } from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { TooltipProvider } from '@docket/ui/primitives';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type JSX, type ReactNode, useRef, useState } from 'react';

import { createQueryClient } from '@/lib/query';
import { SessionExpiredError } from '@/lib/query';
import { signOutAndPurge } from '@/lib/sign-out';

import { AuthenticationInterlockProvider } from './authentication-interlock';
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
 * 5. {@link ServiceWorkerProvider} — registers the service worker on EVERY route, not just the
 *    authenticated shell. Offline support has to be installed before it is needed, and someone
 *    arriving at `/sign-in` is exactly who benefits from the offline page being cached already.
 *
 * All are Client Components, so this file carries the `'use client'` boundary and is
 * mounted once by the root layout. The {@link QueryClient} is created via `useState` (lazy
 * initializer) so a single, stable client survives re-renders without leaking across requests
 * — the App Router client-component pattern for TanStack Query.
 */
export function Providers({ children }: ProvidersProps): JSX.Element {
  // The `onError` hook `createQueryClient` documents was never actually supplied, so the global
  // "a 401 signs you out" path did not exist. Wiring it matters more now that the cache is
  // persisted: an expired session must purge the on-disk copy, not just stop refetching.
  const clientRef = useRef<QueryClient | null>(null);
  const [queryClient] = useState(() => {
    const client = createQueryClient({
      onError: (error) => {
        if (error instanceof SessionExpiredError && clientRef.current) {
          void signOutAndPurge(clientRef.current);
        }
      },
    });
    clientRef.current = client;
    return client;
  });
  return (
    <ContextProvider>
      <VocabularyProvider>
        <TooltipProvider delayDuration={400}>
          <AuthenticationInterlockProvider>
            <QueryClientProvider client={queryClient}>
              <ServiceWorkerProvider>{children}</ServiceWorkerProvider>
            </QueryClientProvider>
          </AuthenticationInterlockProvider>
        </TooltipProvider>
      </VocabularyProvider>
    </ContextProvider>
  );
}
