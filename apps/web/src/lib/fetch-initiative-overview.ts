import { api } from './api';
import { apiQueryOptions } from './query-core';
import { queryKeys } from './query-keys';

/** Typed aggregate Initiative overview query shared by SSR and client rendering. */
export function initiativeOverviewDef(orgId: string, client: typeof api = api) {
  return apiQueryOptions(
    queryKeys.initiatives(orgId),
    () => client.v1.orgs[':orgId'].initiatives.overview.$get({ param: { orgId } }),
    'Could not load initiatives.',
  );
}
