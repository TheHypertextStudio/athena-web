'use client';
import type { z } from 'zod';
import {
  LabelTemplateSuggestionPreview,
  type LabelTemplateSuggestionSelection,
  type LabelTemplateSuggestionRequest,
  TemplateTailoringStatus,
} from '@docket/work/template-gallery-contract';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation } from '@/lib/query';

/** Read only current source labels; an absent optional prefill never starts this query. */
export function labelSuggestionSourcesDef(orgId: string, enabled = true) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'label-suggestion-sources'],
    () =>
      api.v1.orgs[':orgId'].templates.definitions.proposals['label-suggestions'].sources.$get({
        param: { orgId },
      }),
    'Could not load available labels.',
    { enabled, staleTime: 0 },
  );
}
/** Check exact existing examples without generating anything or changing labels. */
export function useLabelSuggestionPreview(orgId: string) {
  return useApiMutation({
    failure: 'silent',
    mutationFn: async (input: z.input<typeof LabelTemplateSuggestionSelection>) =>
      LabelTemplateSuggestionPreview.parse(
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].templates.definitions.proposals[
              'label-suggestions'
            ].preview.$post({ param: { orgId }, json: input }),
          'Could not review these examples.',
        ),
      ),
  });
}
/** Send the reviewed source checkpoint into the existing private suggestion session. */
export function useLabelSuggestionRequest(orgId: string) {
  return useApiMutation({
    failure: 'silent',
    mutationFn: async (input: z.input<typeof LabelTemplateSuggestionRequest>) =>
      TemplateTailoringStatus.parse(
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].templates.definitions.proposals['label-suggestions'].$post({
              param: { orgId },
              json: input,
            }),
          'Could not start this request.',
        ),
      ),
  });
}
