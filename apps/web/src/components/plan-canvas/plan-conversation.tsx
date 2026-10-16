'use client';

/**
 * The focused plan's contextual conversation uses the existing workspace thread and plan tools.
 * The planning activity owns its optional sheet; no global utility rail is required.
 */
import type { PlanDraftOut } from '@docket/work/plan-draft-contract';
import { type JSX, useEffect, useRef } from 'react';

import { AthenaRailConversation } from '@/components/athena/athena-rail-conversation';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import type { PersonalAthenaContext } from '@/lib/athena/presentation';
import { useAppRouter } from '@/lib/interactions/navigation';

/** The rail's empty state: one line, since the board beside it is the subject. */
const PLAN_EMPTY_STATE = { title: 'Tell Athena what this plan needs.' } as const;

/** Props for {@link PlanRailConversation}. */
export interface PlanRailConversationProps {
  readonly orgId: string;
}

/** The rail's Athena panel while a plan is open: the mark, a way to the full page, and the thread. */
export function PlanRailConversation({ orgId }: PlanRailConversationProps): JSX.Element {
  return <AthenaRailConversation orgId={orgId} emptyState={PLAN_EMPTY_STATE} suggestions={false} />;
}

/** The context an "open Athena" from this plan carries. */
function planContext(orgId: string, plan: PlanDraftOut | undefined): PersonalAthenaContext {
  return {
    workspaceId: orgId,
    ...(plan?.rootInitiativeId
      ? { source: { type: 'initiative' as const, id: plan.rootInitiativeId, label: plan.title } }
      : {}),
  };
}

/**
 * Open and seed contextual help only when the person explicitly enters through Plan with Athena.
 */
export function usePlanAthena(
  orgId: string,
  planId: string,
  plan: PlanDraftOut | undefined,
  startRequested: boolean,
): void {
  const router = useAppRouter();
  const { openAthena } = useAthenaPanel();
  const launchedPlan = useRef<string | null>(null);
  useEffect(() => {
    if (!startRequested || !plan || launchedPlan.current === planId) return;
    launchedPlan.current = planId;
    openAthena(planContext(orgId, plan), `Help me plan "${plan.title}". `);
    router.replace(`/orgs/${orgId}/plans/${planId}`);
  }, [openAthena, orgId, plan, planId, router, startRequested]);
}
