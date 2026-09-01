'use client';

import {
  WorkViewOrderRequest,
  type WorkViewOrderRequest as WorkViewOrderRequestValue,
  WorkViewOrderResponse,
} from '@docket/work/work-view-contract';
import type { ViewTarget } from '@docket/work/view-contract';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { type RpcResponse, unwrap, useApiMutation } from '@/lib/query';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

import { workViewFieldCatalog } from './view-state';

/** One board move before target-specific Zod validation brands its ids and operand. */
export interface WorkViewOrderInput {
  readonly target: ViewTarget;
  /** Route organization whose roster owns the manual ordering context. */
  readonly organizationId: string;
  readonly itemId: string;
  readonly groupField: string | null;
  readonly sourceGroupValue: string | null;
  readonly groupValue: string | null;
  readonly beforeId: string | null;
  readonly afterId: string | null;
}

async function orderRpc(
  organizationId: string,
  request: WorkViewOrderRequestValue,
): Promise<RpcResponse<unknown>> {
  return api.v1.orgs[':orgId']['work-views'].order.$patch({
    param: { orgId: organizationId },
    json: request,
  });
}

/** Persist shared manual order and any mutable board-group property change. */
export function useWorkViewOrder() {
  const queryClient = useQueryClient();
  return useApiMutation<ReturnType<typeof WorkViewOrderResponse.parse>, WorkViewOrderInput>({
    mutationFn: async (input) => {
      const field = workViewFieldCatalog(input.target).find(
        (candidate) => candidate.key === input.groupField,
      );
      const common = {
        target: input.target,
        itemId: input.itemId,
        context: { kind: 'organization' as const },
        groupField: input.groupField,
        groupValue: input.groupValue,
        beforeId: input.beforeId,
        afterId: input.afterId,
      };
      const request = WorkViewOrderRequest.parse(
        field?.kind === 'relation-many'
          ? { ...common, sourceGroupValue: input.sourceGroupValue }
          : common,
      );
      return unwrap(async () => {
        const response = await orderRpc(input.organizationId, request);
        if (!response.ok) return response as RpcResponse<never>;
        const value = WorkViewOrderResponse.parse(await response.json());
        return { ok: true, status: response.status, json: async () => value };
      }, `Could not move this ${input.target}.`);
    },
    onSettled: (_data, _error, input) => {
      void invalidateWorkTargetQueries(queryClient, {
        target: input.target,
        ownerOrganizationId: input.organizationId,
      });
    },
  });
}
