'use client';

/**
 * `lib/plan-draft/defs` — typed reads and writes for the planning canvas's plan draft.
 *
 * @remarks
 * The plan document is edited by two hands at once: Athena through her tools and the person
 * through the canvas. Every edit here is optimistic through the same reducer the API runs, is sent
 * against the revision the cache last saw, and rebases once on a stale-revision refusal by reading
 * the plan again and replaying the batch. That is what lets a drag on the canvas land instantly
 * while Athena is still writing.
 *
 * Athena's writes reach the canvas two ways. The plan read polls quickly while the hosting
 * conversation is working and slowly otherwise, and {@link usePlanAthenaSync} watches the thread the
 * rail already streams for a plan-tool action and refetches the plan the moment one lands.
 */
import type { SessionActivityOut } from '@docket/athena/agent-contract';
import {
  PLAN_TOOL_NAMES,
  type PlanCommitOut,
  type PlanDraftCreate,
  type PlanDraftOut,
  type PlanOp,
} from '@docket/work/plan-draft-contract';
import { PlanOpError, applyPlanOps } from '@docket/work/plan-draft';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { useOrgChatThread } from '@/lib/athena/chat-defs';
import { UserFacingError, userErrorMessage } from '@/lib/problem';
import { STALE, apiQueryOptions, unwrap } from '@/lib/query-core';
import { queryKeys, useApiMutation, useLiveApiQuery } from '@/lib/query';

/** Poll cadence while the hosting conversation is working. */
export const PLAN_LIVE_POLL_MS = 2_000;
/** Poll cadence while nobody is talking. */
export const PLAN_IDLE_POLL_MS = 10_000;

/** Definition for `GET /v1/me/plans/:id`. */
export function planDef(planId: string) {
  return apiQueryOptions<PlanDraftOut>(
    queryKeys.plan(planId),
    () => api.v1.me.plans[':id'].$get({ param: { id: planId } }),
    'Could not load this plan.',
    { staleTime: STALE.realtime, enabled: planId.length > 0 },
  );
}

/** Read one plan as a live query. */
export function usePlan(planId: string, live: boolean) {
  return useLiveApiQuery(planDef(planId), live ? PLAN_LIVE_POLL_MS : PLAN_IDLE_POLL_MS);
}

/** Fetch a plan once, bypassing the cache. */
export async function fetchPlan(planId: string): Promise<PlanDraftOut> {
  return unwrap(
    () => api.v1.me.plans[':id'].$get({ param: { id: planId } }),
    'Could not load this plan.',
  );
}

async function patchPlan(
  planId: string,
  revision: number,
  ops: readonly PlanOp[],
): Promise<PlanDraftOut> {
  return unwrap(
    () =>
      api.v1.me.plans[':id'].$patch({
        param: { id: planId },
        json: { revision, ops: [...ops] },
      }),
    'Could not save that change.',
  );
}

/** Whether a failure is the API refusing a batch written against an old revision. */
function isStaleRevision(error: unknown): boolean {
  return error instanceof UserFacingError && error.status === 412;
}

/** The reducer environment for optimistic edits: templates are applied by the server only. */
const OPTIMISTIC_ENV = { templatePayload: () => undefined };

/** Whether a batch can be applied ahead of the server. */
function optimisticallyApplicable(ops: readonly PlanOp[]): boolean {
  return ops.every((op) => op.op !== 'apply_template');
}

/** What the canvas needs to edit a plan. */
export interface PlanOpsController {
  /** Apply a batch; resolves with the plan the server returned, or null when it was refused. */
  readonly apply: (ops: readonly PlanOp[]) => Promise<PlanDraftOut | null>;
  /** Whether a batch is in flight. */
  readonly pending: boolean;
  /** Application-owned copy for the last refusal, or null. */
  readonly error: string | null;
  /** Clear the last refusal. */
  readonly clearError: () => void;
}

/**
 * Edit a plan optimistically against the cached revision, rebasing once on a stale refusal.
 *
 * @param planId - The plan to edit.
 * @returns the controller the canvas gestures call.
 */
export function usePlanOps(planId: string): PlanOpsController {
  const queryClient = useQueryClient();
  const key = useMemo(() => queryKeys.plan(planId), [planId]);
  const [error, setError] = useState<string | null>(null);

  const mutation = useApiMutation<PlanDraftOut, readonly PlanOp[]>({
    mutationFn: async (ops) => {
      const cached = queryClient.getQueryData<PlanDraftOut>(key);
      const revision = cached?.revision ?? (await fetchPlan(planId)).revision;
      try {
        return await patchPlan(planId, revision, ops);
      } catch (caught) {
        if (!isStaleRevision(caught)) throw caught;
        const fresh = await fetchPlan(planId);
        queryClient.setQueryData(key, fresh);
        return patchPlan(planId, fresh.revision, ops);
      }
    },
    onMutate: (ops) => {
      if (!optimisticallyApplicable(ops)) return;
      queryClient.setQueryData<PlanDraftOut>(key, (current) => {
        if (!current) return current;
        try {
          return { ...current, document: applyPlanOps(current.document, ops, OPTIMISTIC_ENV) };
        } catch (caught) {
          if (caught instanceof PlanOpError) return current;
          throw caught;
        }
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
    },
    onError: (caught) => {
      setError(userErrorMessage(caught, 'Could not save that change.'));
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const { mutateAsync } = mutation;
  const apply = useCallback(
    async (ops: readonly PlanOp[]): Promise<PlanDraftOut | null> => {
      setError(null);
      try {
        return await mutateAsync(ops);
      } catch {
        return null;
      }
    },
    [mutateAsync],
  );
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { apply, pending: mutation.isPending, error, clearError };
}

/** Confirm a set of refs; the plan cache and the workspace lists refresh on success. */
export function useCommitPlan(planId: string, orgId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<PlanCommitOut, readonly string[]>({
    mutationFn: (refs) =>
      unwrap(
        () =>
          api.v1.me.plans[':id'].commit.$post({ param: { id: planId }, json: { refs: [...refs] } }),
        'Could not create that part of the plan.',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.plan(planId), data.plan);
    },
    invalidateKeys: [
      queryKeys.initiatives(orgId),
      queryKeys.projects(orgId),
      queryKeys.tasks(orgId),
      queryKeys.plans(),
    ],
  });
}

/** Start a plan, or reopen the one rooted on the same initiative. */
export function useCreatePlan() {
  const queryClient = useQueryClient();
  return useApiMutation<PlanDraftOut, PlanDraftCreate>({
    mutationFn: (body) =>
      unwrap(() => api.v1.me.plans.$post({ json: body }), 'Could not start a plan.'),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.plan(data.id), data);
    },
    invalidateKeys: [queryKeys.plans()],
  });
}

/** Archive a plan without creating anything. */
export function useArchivePlan(planId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<PlanDraftOut, null>({
    mutationFn: () =>
      unwrap(
        () => api.v1.me.plans[':id'].archive.$post({ param: { id: planId } }),
        'Could not archive this plan.',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.plan(planId), data);
    },
    invalidateKeys: [queryKeys.plans()],
  });
}

const PLAN_WRITE_TOOLS: ReadonlySet<string> = new Set([
  PLAN_TOOL_NAMES.draft,
  PLAN_TOOL_NAMES.commit,
  PLAN_TOOL_NAMES.start,
]);

/** The id of the newest plan-tool action in a thread, or null. */
export function latestPlanActionId(activities: readonly SessionActivityOut[]): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.type !== 'action') continue;
    const action = activity.body['action'];
    const kind =
      action !== null && typeof action === 'object' && 'kind' in action
        ? (action as { kind?: unknown }).kind
        : undefined;
    if (typeof kind === 'string' && PLAN_WRITE_TOOLS.has(kind)) return activity.id;
  }
  return null;
}

/** Session states after which Athena is no longer writing. */
const SETTLED_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'canceled']);

/**
 * Keep the plan in step with the conversation that is shaping it.
 *
 * @remarks
 * Reads the org thread the Athena rail already streams. When a new plan-tool action arrives the
 * plan is refetched at once, and `working` reports whether the thread is mid-turn so the plan's
 * own poll can tighten while Athena writes.
 *
 * @param orgId - The workspace the conversation is focused on.
 * @param planId - The plan to refresh.
 * @returns whether Athena is currently working on the thread.
 */
export function usePlanAthenaSync(orgId: string, planId: string): { working: boolean } {
  const queryClient = useQueryClient();
  const thread = useOrgChatThread(orgId);
  const activities = thread.data?.activities;
  const latest = useMemo(() => latestPlanActionId(activities ?? []), [activities]);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (latest === null || seen.current === latest) return;
    const first = seen.current === null;
    seen.current = latest;
    if (first) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.plan(planId) });
  }, [latest, planId, queryClient]);
  const status = thread.data?.status;
  return { working: status !== undefined && !SETTLED_STATUSES.has(status) };
}
