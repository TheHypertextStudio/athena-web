'use client';

import { ContextProvider } from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClientProvider } from '@tanstack/react-query';
import { type JSX, type ReactNode, useState } from 'react';

import { createQueryClient } from '@/lib/query';

import { AuthenticationInterlockProvider } from './authentication-interlock';

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
 *
 * All are Client Components, so this file carries the `'use client'` boundary and is
 * mounted once by the root layout. The {@link QueryClient} is created via `useState` (lazy
 * initializer) so a single, stable client survives re-renders without leaking across requests
 * — the App Router client-component pattern for TanStack Query.
 */
export function Providers({ children }: ProvidersProps): JSX.Element {
  const [queryClient] = useState(() => createQueryClient());
  return (
    <ContextProvider>
      <VocabularyProvider>
        <TooltipProvider delayDuration={400}>
          <AuthenticationInterlockProvider>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          </AuthenticationInterlockProvider>
        </TooltipProvider>
      </VocabularyProvider>
    </ContextProvider>
  );
}
