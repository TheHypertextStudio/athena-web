'use client';

/**
 * `plans/[planId]/plan-route` — the plan route's state, one concern per hook.
 *
 * @remarks
 * The shell requests the route makes while mounted, and the plan with its editing controllers.
 * `plan-client.tsx` composes these with the rail conversation into the panel.
 */
import { useShellRail, useShellSidebar } from '@docket/ui/components';
import type { PlanCommitOut, PlanDraftOut, PlanOp } from '@docket/work/plan-draft-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { usePlanActorResolver } from '@/components/plan-canvas/plan-actors';
import type { PlanCanvasPanelProps } from '@/components/plan-canvas/plan-canvas-panel';
import { PLAN_RAIL_WIDE_PX } from '@/components/plan-canvas/plan-panel-support';
import { EMPTY_PLAN_DIFF, planDiff, type PlanDiff } from '@/components/plan-canvas/plan-diff';
import { api } from '@/lib/api';
import type { PlanOpsController } from '@/lib/plan-draft/defs';
import { useCommitPlan, usePlan, usePlanAthenaSync, usePlanOps } from '@/lib/plan-draft/defs';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';

const OPTION_KINDS = ['actors', 'initiatives'] as const;

/** The sidebar drops to its icon rail on any window narrower than this while a plan is open. */
const COMPACT_SIDEBAR_BELOW_PX = 1920;

/**
 * Ask the shell for room while the route is mounted: the sidebar drops to its icon rail, and on a
 * narrower window the right rail rests collapsed until the conversation is asked for.
 */
export function usePlanShellRequests(): void {
  const { requestCompact } = useShellSidebar();
  useEffect(() => {
    if (window.innerWidth >= COMPACT_SIDEBAR_BELOW_PX) return undefined;
    return requestCompact();
  }, [requestCompact]);
  const { requestCollapsed } = useShellRail();
  useEffect(() => {
    if (window.innerWidth >= PLAN_RAIL_WIDE_PX) return undefined;
    return requestCollapsed();
  }, [requestCollapsed]);
}

/**
 * Which revisions are the person's own, so the panel can tell a local edit from a remote one and
 * only animate what Athena changed.
 */
function useRemoteDiff(plan: PlanDraftOut | undefined): {
  readonly remoteDiff: PlanDiff;
  readonly markLocal: (revision: number) => void;
} {
  const local = useRef(new Set<number>());
  const previous = useRef<PlanDraftOut | null>(null);
  const [remoteDiff, setRemoteDiff] = useState<PlanDiff>(EMPTY_PLAN_DIFF);
  useEffect(() => {
    if (!plan) return;
    const before = previous.current;
    previous.current = plan;
    if (before === null || before.revision === plan.revision) return;
    if (local.current.has(plan.revision)) {
      setRemoteDiff(EMPTY_PLAN_DIFF);
      return;
    }
    setRemoteDiff(planDiff(before.document, plan.document));
  }, [plan]);
  const markLocal = useCallback((revision: number) => {
    local.current.add(revision);
  }, []);
  return { remoteDiff, markLocal };
}

/** What {@link usePlanRouteData} returns: the plan, its controllers, and who may edit it. */
export interface PlanRouteData {
  readonly plan: PlanDraftOut | undefined;
  readonly pending: boolean;
  readonly error: unknown;
  readonly canEdit: boolean;
  readonly committing: boolean;
  readonly remoteDiff: PlanDiff;
  readonly ops: PlanOpsController;
  readonly onCommit: (refs: readonly string[]) => Promise<PlanCommitOut | null>;
  readonly memberOptions: PlanCanvasPanelProps['memberOptions'];
  readonly initiativeOptions: PlanCanvasPanelProps['initiativeOptions'];
  readonly resolveActor: PlanCanvasPanelProps['resolveActor'];
}

/** The plan, kept in step with Athena's session, with the controllers that edit and confirm it. */
export function usePlanRouteData(orgId: string, planId: string): PlanRouteData {
  const { working } = usePlanAthenaSync(orgId, planId);
  const planQuery = usePlan(planId, working);
  const plan = planQuery.data;
  const ops = usePlanOps(planId);
  const commit = useCommitPlan(planId, orgId);
  const { remoteDiff, markLocal } = useRemoteDiff(plan);
  const options = useComposerOptions(orgId, OPTION_KINDS, true);
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
    ),
  );
  const members = membersQ.data?.items ?? [];
  const canContribute = useOrgCapability(members, rolesQ.data?.items ?? [], 'contribute');
  const resolveActor = usePlanActorResolver(members);
  const trackedOps = useMemo<PlanOpsController>(
    () => ({
      ...ops,
      apply: async (batch: readonly PlanOp[]) => {
        const result = await ops.apply(batch);
        if (result) markLocal(result.revision);
        return result;
      },
    }),
    [markLocal, ops],
  );
  const { mutateAsync: commitAsync, isPending: committing } = commit;
  const onCommit = useCallback(
    async (refs: readonly string[]) => {
      try {
        const result = await commitAsync(refs);
        markLocal(result.plan.revision);
        return result;
      } catch {
        return null;
      }
    },
    [commitAsync, markLocal],
  );
  return {
    plan,
    pending: planQuery.isPending,
    error: planQuery.isError ? planQuery.error : null,
    canEdit: canContribute && plan?.status !== 'archived',
    committing,
    remoteDiff,
    ops: trackedOps,
    onCommit,
    memberOptions: options.memberOptions,
    initiativeOptions: options.initiativeOptions,
    resolveActor,
  };
}
