'use client';

/**
 * `components/plan-canvas/plan-conversation` — the plan's conversation, in the shell's rail.
 *
 * @remarks
 * A plan is shaped by talking, and the conversation is a peer of the whole canvas rather than a
 * panel over part of it, so it lives where the shell already keeps a peer of `<main>`: the right
 * rail's Athena panel. While the route is mounted it hands the rail this content, on the org's
 * chat thread, which is the session the plan tools bind to. The rail's own icon opens and closes
 * it, and the shell's sheet serves it on a compact window.
 */
import type { PlanDraftOut } from '@docket/work/plan-draft-contract';
import { type JSX, useEffect, useRef } from 'react';

import { AthenaRailConversation } from '@/components/athena/athena-rail-conversation';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import type { PersonalAthenaContext } from '@/lib/athena/presentation';
import { useAppRouter } from '@/lib/interactions/navigation';

import { PLAN_RAIL_WIDE_PX } from './plan-panel-support';

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
 * Hand the rail this plan's conversation while the route is mounted, reveal it on arrival, and
 * seed it with an opening line when an entry point asked for a start.
 */
export function usePlanAthena(
  orgId: string,
  planId: string,
  plan: PlanDraftOut | undefined,
  startRequested: boolean,
): void {
  const router = useAppRouter();
  const { openAthena, provideRailContent } = useAthenaPanel();
  useEffect(
    () => provideRailContent(<PlanRailConversation orgId={orgId} />),
    [orgId, provideRailContent],
  );
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current || startRequested) return;
    revealed.current = true;
    if (window.innerWidth >= PLAN_RAIL_WIDE_PX) openAthena();
  }, [openAthena, startRequested]);
  useEffect(() => {
    if (!startRequested || !plan) return;
    revealed.current = true;
    openAthena(planContext(orgId, plan), `Help me plan "${plan.title}". `);
    router.replace(`/orgs/${orgId}/plans/${planId}`);
  }, [openAthena, orgId, plan, planId, router, startRequested]);
}
