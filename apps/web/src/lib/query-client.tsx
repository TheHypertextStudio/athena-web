/**
 * React Query client configuration and provider.
 *
 * @packageDocumentation
 */

'use client';

import {
  QueryClient,
  QueryClientProvider as TanStackQueryClientProvider,
} from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Query client provider for the application.
 *
 * Creates a new QueryClient instance per component tree to avoid
 * shared state between different renders (important for SSR).
 */
export function QueryClientProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Default stale time of 30 seconds
            staleTime: 30 * 1000,
            // Refetch on window focus
            refetchOnWindowFocus: true,
            // Retry failed requests up to 3 times
            retry: 3,
          },
        },
      }),
  );

  return <TanStackQueryClientProvider client={queryClient}>{children}</TanStackQueryClientProvider>;
}
