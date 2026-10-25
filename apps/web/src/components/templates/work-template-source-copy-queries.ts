'use client';
import type {
  WorkTemplateSourceCopyAcceptRequest,
  WorkTemplateSourceCopyPreviewRequest,
} from '@docket/work/template-copy';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation } from '@/lib/query';

/** Request an authorized checked closure for actual saved drafts or publication snapshots. */
export function useTemplateSourceCopyPreview(orgId: string) {
  return useApiMutation({
    failure: 'silent',
    mutationFn: (input: WorkTemplateSourceCopyPreviewRequest) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].templates.definitions.copies.preview.$post({
            param: { orgId },
            json: input,
          }),
        'Could not review this copy.',
      ),
  });
}
/** Keep only the exact reviewed source choices through the canonical independent-copy writer. */
export function useTemplateSourceCopyAccept(orgId: string) {
  return useApiMutation({
    failure: 'silent',
    mutationFn: (input: WorkTemplateSourceCopyAcceptRequest) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].templates.definitions.copies.$post({
            param: { orgId },
            json: input,
          }),
        'Could not keep this copy.',
      ),
    invalidateKeys: [queryKeys.templates(orgId)],
  });
}
/** Reconcile an opaque original request before attempting any source read after reload. */
export function templateSourceCopyStatusDef(orgId: string, requestId: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'copies', 'request', requestId],
    () =>
      api.v1.orgs[':orgId'].templates.definitions.copies.requests[':requestId'].$get({
        param: { orgId, requestId },
      }),
    'Could not check whether this copy was kept.',
    { staleTime: 0 },
  );
}
