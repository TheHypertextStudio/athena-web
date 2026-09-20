'use client';

/**
 * `plans/[planId]/plan-route` — the plan route's state, one concern per hook.
 *
 * @remarks
 * The shell requests the route makes while mounted, and the plan with its editing controllers.
 * `plan-client.tsx` composes these with the rail conversation into the panel.
 */
import { useShellRail } from '@docket/ui/components';
import type {
  PlanCommitOut,
  PlanDraftOut,
  PlanOp,
  PlanRoster,
} from '@docket/work/plan-draft-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCompactSidebarWhileMounted } from '@/components/canvas/canvas-floating-chrome';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { usePlanActorResolver } from '@/components/plan-canvas/plan-actors';
import type { PlanCanvasPanelProps } from '@/components/plan-canvas/plan-canvas-panel';
import { PLAN_RAIL_WIDE_PX } from '@/components/plan-canvas/plan-panel-support';
import { EMPTY_PLAN_DIFF, planDiff, type PlanDiff } from '@/components/plan-canvas/plan-diff';
import { api } from '@/lib/api';
import type { UndoPlanCommit } from '@/components/plan-canvas/use-plan-view';
import type { PlanOpsController } from '@/lib/plan-draft/defs';
import {
  planRosterDef,
  useCommitPlan,
  usePlan,
  usePlanAthenaSync,
  usePlanOps,
  useUndoPlanCommit,
} from '@/lib/plan-draft/defs';
import { apiQueryOptions, queryKeys, useApiListQuery, useApiQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';

const OPTION_KINDS = ['actors', 'initiatives'] as const;

/**
 * Ask the shell for room while the route is mounted: the sidebar drops to its icon rail, and on a
 * narrower window the right rail rests collapsed until the conversation is asked for.
 */
export function usePlanShellRequests(): void {
  useCompactSidebarWhileMounted();
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

/** The roster before it loads: nobody to assign yet. */
const EMPTY_ROSTER: PlanRoster = { people: [], teams: [] };

/**
 * Undo a commit, marking the revision the undo writes as the person's own so the canvas does not
 * announce it as Athena's.
 */
function usePlanUndo(
  planId: string,
  orgId: string,
  revision: number | undefined,
  markLocal: (revision: number) => void,
): UndoPlanCommit {
  const { mutateAsync } = useUndoPlanCommit(planId, orgId);
  return useCallback(
    async (changeSetId: string) => {
      if (revision !== undefined) markLocal(revision + 1);
      try {
        await mutateAsync(changeSetId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    },
    [markLocal, mutateAsync, revision],
  );
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
  readonly onUndoCommit: PlanCanvasPanelProps['onUndoCommit'];
  readonly roster: PlanRoster;
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
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId }, query: { limit: '100' } }),
      'Could not load members.',
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId }, query: { limit: '100' } }),
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
  const onUndoCommit = usePlanUndo(planId, orgId, plan?.revision, markLocal);
  const rosterQ = useApiQuery(planRosterDef(planId));
  return {
    plan,
    pending: planQuery.isPending,
    error: planQuery.isError ? planQuery.error : null,
    canEdit: canContribute && plan?.status !== 'archived',
    committing,
    remoteDiff,
    ops: trackedOps,
    onCommit,
    onUndoCommit,
    roster: rosterQ.data ?? EMPTY_ROSTER,
    memberOptions: options.memberOptions,
    initiativeOptions: options.initiativeOptions,
    resolveActor,
  };
}
