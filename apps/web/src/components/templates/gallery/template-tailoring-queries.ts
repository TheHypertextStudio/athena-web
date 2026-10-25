'use client';
import {
  TemplateTailoringPreview,
  TemplateTailoringStatus,
  type TemplateTailoringRequest,
  type TemplateTailoringSelection,
} from '@docket/work/template-gallery-contract';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation } from '@/lib/query';
const route = api.v1.orgs[':orgId'].templates.definitions.proposals.tailoring;
/** Current authorized saved references and optional capability availability. */
export function tailoringSourcesDef(orgId: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'tailoring-sources'],
    () => route.sources.$get({ param: { orgId } }),
    'Could not load saved context.',
    { staleTime: 0 },
  );
}
/** Poll only an actual persisted request selected by its safe URL reference. */
export function tailoringStatusDef(orgId: string, id: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'tailoring', id],
    () => route[':id'].$get({ param: { orgId, id } }),
    'Could not load this request.',
    { enabled: Boolean(id), staleTime: 0 },
  );
}
/** Review exact selected context without requesting generation. */
export function useTailoringPreview(orgId: string) {
  return useApiMutation({
    failure: 'silent',
    mutationFn: async (input: TemplateTailoringSelection) =>
      TemplateTailoringPreview.parse(
        await unwrap(
          () => route.preview.$post({ param: { orgId }, json: input }),
          'Could not review this context.',
        ),
      ),
  });
}
/** Request actual Athena execution against the checked saved source checkpoint. */
export function useTailoringRequest(orgId: string) {
  return useApiMutation({
    failure: 'silent',
    mutationFn: async (input: TemplateTailoringRequest) =>
      TemplateTailoringStatus.parse(
        await unwrap(
          () => route.$post({ param: { orgId }, json: input }),
          'Could not start this request.',
        ),
      ),
  });
}
/** Retry a persisted failed request through its original durable runner. */
export function useTailoringRetry(orgId: string) {
  return useApiMutation({
    failure: 'silent',
    mutationFn: async (id: string) =>
      TemplateTailoringStatus.parse(
        await unwrap(
          () => route[':id'].retry.$post({ param: { orgId, id } }),
          'Could not retry this request.',
        ),
      ),
    invalidateKeys: [queryKeys.templates(orgId)],
  });
}
