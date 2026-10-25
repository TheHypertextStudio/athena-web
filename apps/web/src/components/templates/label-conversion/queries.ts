'use client';
import type { z } from 'zod';
import type {
  LabelTemplateConversionChoices,
  LabelTemplateConversionConfirm,
} from '@docket/work/work-template-contract';
import {
  LabelTemplateConversionReview,
  LabelTemplateConversionReceipt,
} from '@docket/work/work-template-contract';
import { WorkViewQueryResponse, type WorkViewQueryRequest } from '@docket/work/work-view-contract';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';
import { validatedRpcResponse } from '@/components/work-views/validated-rpc-response';

/** A conversion reads the ordinary authorized work-view transport and cache owner. */
export function conversionWorkDef(orgId: string, request: WorkViewQueryRequest) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'label-conversion', 'work', request],
    () =>
      validatedRpcResponse(
        () => api.v1.orgs[':orgId']['work-views'].query.$post({ param: { orgId }, json: request }),
        WorkViewQueryResponse,
      ),
    'Could not load matching work.',
    { staleTime: 0 },
  );
}
/** Read one actual private command outcome without reapplying its work changes. */
export function conversionReceiptDef(orgId: string, requestId: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'label-conversion', 'request', requestId],
    () =>
      api.v1.orgs[':orgId'].templates.definitions['label-conversions'].requests[':requestId'].$get({
        param: { orgId, requestId },
      }),
    'Could not check the saved change.',
    { staleTime: 0 },
  );
}
/** Canonical review/confirm/Undo only; each error is shown inside the focused flow. */
export function useConversionTransport(orgId: string) {
  const client = useQueryClient();
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: queryKeys.labels(orgId) });
    await client.invalidateQueries({
      queryKey: [...queryKeys.templates(orgId), 'label-conversion'],
    });
    for (const target of ['task', 'project', 'program', 'initiative'] as const)
      await invalidateWorkTargetQueries(client, { target, ownerOrganizationId: orgId });
  };
  const preview = useApiMutation({
    failure: 'silent',
    mutationFn: async (input: z.input<typeof LabelTemplateConversionChoices>) =>
      LabelTemplateConversionReview.parse(
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].templates.definitions['label-conversions'].preview.$post({
              param: { orgId },
              json: input,
            }),
          'Could not prepare this review.',
        ),
      ),
  });
  const confirm = useApiMutation({
    failure: 'silent',
    mutationFn: async (input: z.input<typeof LabelTemplateConversionConfirm>) =>
      LabelTemplateConversionReceipt.parse(
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].templates.definitions['label-conversions'].$post({
              param: { orgId },
              json: input,
            }),
          'Could not save this change.',
        ),
      ),
    onSuccess: refresh,
  });
  const undo = useApiMutation({
    failure: 'silent',
    mutationFn: async (requestId: string) =>
      LabelTemplateConversionReceipt.parse(
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].templates.definitions['label-conversions'].requests[
              ':requestId'
            ].undo.$post({ param: { orgId, requestId } }),
          'Could not undo this change.',
        ),
      ),
    onSuccess: refresh,
  });
  return { preview, confirm, undo };
}
