'use client';
import {
  TemplateProposalReview,
  type TemplateProposalDecision,
} from '@docket/work/work-template-contract';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation } from '@/lib/query';

/** Read exact recipient-authorized content separately from the safe Inbox notification. */
export function templateProposalDef(orgId: string, id: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'proposals', id],
    () =>
      api.v1.orgs[':orgId'].templates.definitions.proposals[':id'].$get({ param: { orgId, id } }),
    'Could not open this template review.',
    { staleTime: 0 },
  );
}
/** Execute a checked domain decision; generic notification act is never used for review. */
export function useTemplateProposalDecision(orgId: string, id: string) {
  return useApiMutation({
    failure: 'silent',
    mutationFn: async (input: z.infer<typeof TemplateProposalDecision>) =>
      TemplateProposalReview.parse(
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].templates.definitions.proposals[':id'].decision.$post({
              param: { orgId, id },
              json: input,
            }),
          'Could not apply this decision. Your template is unchanged.',
        ),
      ),
    invalidateKeys: [queryKeys.templates(orgId), queryKeys.notifications()],
  });
}
