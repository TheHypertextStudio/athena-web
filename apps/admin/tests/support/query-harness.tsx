import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Wrap a screen in a query client configured for tests.
 *
 * @remarks
 * Every operator screen reads through `lib/query.ts`, so mounting one in a test needs a client.
 * The test client differs from the app's in two ways that matter: retries are off, so a test
 * asserting a failure state does not wait for a second attempt; and `refetchOnWindowFocus` is off,
 * so jsdom's focus events cannot re-fire a read mid-assertion.
 *
 * A fresh client per call keeps one test's cached response from satisfying the next test's read.
 *
 * @param children - The screen under test.
 * @returns the wrapped tree.
 */
export function withQueryClient(children: ReactNode): ReactNode {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
