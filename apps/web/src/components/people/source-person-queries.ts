'use client';

import type {
  ExternalActorResolve,
  SourcePersonReferenceOut,
} from '@docket/connections/integration-contract';
import { api } from '@/lib/api';
import { apiQueryOptions, useApiMutation, unwrap } from '@/lib/query';

/** Suggested people for one provider identity, scoped to its workspace and integration. */
export function sourcePersonCandidatesQuery(
  orgId: string,
  source: SourcePersonReferenceOut,
  enabled: boolean,
) {
  return apiQueryOptions(
    ['org', orgId, 'source-people', source.externalActorId, 'candidates'],
    () =>
      api.v1.orgs[':orgId'].integrations[':id']['external-actors'][
        ':externalActorId'
      ].candidates.$get({
        param: { orgId, id: source.integrationId, externalActorId: source.externalActorId },
      }),
    'Could not load matching people.',
    { enabled },
  );
}

/** Apply an explicit identity decision and refresh every affected workspace view. */
export function useResolveSourcePerson(orgId: string, source: SourcePersonReferenceOut) {
  return useApiMutation({
    mutationFn: ({ decision, requestId }: { decision: ExternalActorResolve; requestId: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations[':id']['external-actors'][
            ':externalActorId'
          ].resolution.$post(
            {
              param: { orgId, id: source.integrationId, externalActorId: source.externalActorId },
              json: {
                ...decision,
                ...(source.updatedAt ? { expectedUpdatedAt: source.updatedAt } : {}),
              },
            },
            { headers: { 'Idempotency-Key': requestId } },
          ),
        'Could not link this identity.',
      ),
    invalidateKeys: [['org', orgId]],
  });
}
