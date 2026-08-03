import type { api as ApiClient } from './api';
import { apiQueryOptions } from './query-core';
import { queryKeys } from './query-keys';

/**
 * Typed aggregate Initiative overview query shared by SSR and client rendering.
 *
 * @remarks
 * `client` is required, not defaulted, so this module never imports `./api` itself — that import
 * eagerly calls the client-only `withOfflineOutbox`, which fails the build the instant a Server
 * Component pulls this file in (as `initiatives/page.tsx` does).
 */
export function initiativeOverviewDef(orgId: string, client: typeof ApiClient) {
  return apiQueryOptions(
    queryKeys.initiatives(orgId),
    () => client.v1.orgs[':orgId'].initiatives.overview.$get({ param: { orgId } }),
    'Could not load initiatives.',
  );
}
