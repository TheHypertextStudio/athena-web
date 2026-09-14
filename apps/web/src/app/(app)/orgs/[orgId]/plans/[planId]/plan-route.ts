'use client';

/**
 * `plans/[planId]/plan-route` — the plan route's state, one concern per hook.
 *
 * @remarks
 * The shell requests the route makes while mounted, the plan and its editing controllers, and the
 * conversation the route hosts beside the board. `plan-client.tsx` composes these into the panel.
 */
import { useShellRail, useShellSidebar } from '@docket/ui/components';
import type { PlanCommitOut, PlanDraftOut, PlanOp } from '@docket/work/plan-draft-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { usePlanActorResolver } from '@/components/plan-canvas/plan-actors';
import type { PlanCanvasPanelProps } from '@/components/plan-canvas/plan-canvas-panel';
import { EMPTY_PLAN_DIFF, planDiff, type PlanDiff } from '@/components/plan-canvas/plan-diff';
import { api } from '@/lib/api';
import { useAppRouter } from '@/lib/interactions/navigation';
import type { PlanOpsController } from '@/lib/plan-draft/defs';
import { useCommitPlan, usePlan, usePlanAthenaSync, usePlanOps } from '@/lib/plan-draft/defs';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';

const OPTION_KINDS = ['actors', 'initiatives'] as const;

/** The conversation floats beside the board from this width; below it, the shell's sheet serves. */
export const CONVERSATION_BESIDE_CANVAS_QUERY = '(min-width: 1024px)';

/** The sidebar drops to its icon rail on any window narrower than this while a plan is open. */
const COMPACT_SIDEBAR_BELOW_PX = 1920;

/** Ask the shell for room while the route is mounted: the icon rail, and a collapsed right rail. */
export function usePlanShellRequests(): void {
  const { requestCompact } = useShellSidebar();
  useEffect(() => {
    if (window.innerWidth >= COMPACT_SIDEBAR_BELOW_PX) return undefined;
    return requestCompact();
  }, [requestCompact]);
  const { requestCollapsed } = useShellRail();
  useEffect(() => requestCollapsed(), [requestCollapsed]);
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

/** What {@link usePlanConversation} returns. */
export interface PlanConversationHost {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly draftRequest: { readonly text: string; readonly version: number } | null;
  /** Open the conversation with a draft about this plan. */
  readonly ask: (text: string) => void;
}

/** The context an "open Athena" from this plan carries. */
function planContext(orgId: string, plan: PlanDraftOut | undefined) {
  return {
    workspaceId: orgId,
    ...(plan?.rootInitiativeId
      ? { source: { type: 'initiative' as const, id: plan.rootInitiativeId, label: plan.title } }
      : {}),
  };
}

/**
 * The conversation this route hosts beside the board. While the window is wide enough the route
 * registers as Athena's host and claims the rail's Athena icon, so every "open Athena" lands in
 * the floating column; on a compact viewport the shell's sheet serves instead. The column is open
 * on arrival where it fits, and an entry point that asks for a start opens it with an opening line.
 */
export function usePlanConversation(
  orgId: string,
  planId: string,
  plan: PlanDraftOut | undefined,
  startRequested: boolean,
): PlanConversationHost {
  const router = useAppRouter();
  const { openAthena, registerHost } = useAthenaPanel();
  const { claimPanel } = useShellRail();
  const [open, setOpen] = useState(false);
  const [draftRequest, setDraftRequest] = useState<PlanConversationHost['draftRequest']>(null);
  useEffect(() => {
    if (!window.matchMedia(CONVERSATION_BESIDE_CANVAS_QUERY).matches) return undefined;
    const releaseHost = registerHost({
      reveal: (draft) => {
        setOpen(true);
        if (draft === undefined) return;
        setDraftRequest((current) => ({ text: draft, version: (current?.version ?? 0) + 1 }));
      },
    });
    const releaseClaim = claimPanel('athena', () => {
      setOpen((current) => !current);
    });
    return () => {
      releaseHost();
      releaseClaim();
    };
  }, [claimPanel, registerHost]);
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current || startRequested) return;
    revealed.current = true;
    if (window.matchMedia(CONVERSATION_BESIDE_CANVAS_QUERY).matches) setOpen(true);
  }, [startRequested]);
  useEffect(() => {
    if (!startRequested || !plan) return;
    revealed.current = true;
    openAthena(planContext(orgId, plan), `Help me plan "${plan.title}". `);
    router.replace(`/orgs/${orgId}/plans/${planId}`);
  }, [openAthena, orgId, plan, planId, router, startRequested]);
  const ask = useCallback(
    (text: string) => {
      openAthena(planContext(orgId, plan), text);
    },
    [openAthena, orgId, plan],
  );
  return { open, setOpen, draftRequest, ask };
}
