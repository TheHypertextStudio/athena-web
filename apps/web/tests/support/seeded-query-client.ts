import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';

import { queryKeys } from '../../src/lib/query';

/** Retry-free, so a failing mock settles at once instead of backing off. */
const RETRY_FREE: QueryClientConfig = {
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
};

/**
 * A query client holding what the app shell has already fetched by the time a composer opens.
 *
 * The shell keeps the resume-drafts preference warm, so a composer opens without waiting for it.
 * A test that renders a composer without the shell seeds the same answer (preference off).
 *
 * @param config - Client options; defaults to retry-free queries and mutations.
 */
export function seededQueryClient(config: QueryClientConfig = RETRY_FREE): QueryClient {
  const client = new QueryClient(config);
  client.setQueryData(queryKeys.hubPreferences(), {});
  return client;
}
