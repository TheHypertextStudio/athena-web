'use client';
import type { InferRequestType } from 'hono/client';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, unwrap, useApiMutation } from '@/lib/query';
import { fetchAllTeams } from '@/lib/org-collection-pages';

type PreviewEndpoint =
  (typeof api)['v1']['orgs'][':orgId']['templates']['definitions'][':id']['blueprint-preview'];
/** Existing typed root body and read-only choices accepted by the canonical review route. */
export type BlueprintPreviewRequest = InferRequestType<PreviewEndpoint['$post']>['json'];

/** A read-only POST through the shared query layer; it never invalidates or creates work. */
export function useBlueprintPreview(orgId: string) {
  return useApiMutation({
    failure: 'silent',
    mutationFn: ({ id, request }: { id: string; request: BlueprintPreviewRequest }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].templates.definitions[':id']['blueprint-preview'].$post({
            param: { orgId, id },
            json: request,
          }),
        'Could not review the template work.',
      ),
  });
}

/** Reuse the workspace team collection for a teamless root's child assignment fallback. */
export function blueprintCreationTeamsDef(orgId: string) {
  return apiQueryOptions(
    queryKeys.teams(orgId),
    () => fetchAllTeams(api, orgId),
    'Could not load teams.',
    { staleTime: STALE.static },
  );
}
