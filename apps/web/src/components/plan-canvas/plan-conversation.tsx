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
import { OpenInNew, Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { PlanDraftOut } from '@docket/work/plan-draft-contract';
import { type JSX, useEffect, useRef, useState } from 'react';

import AthenaConversation from '@/components/athena/athena-conversation';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import Link from '@/components/docket-link';
import type { PersonalAthenaContext } from '@/lib/athena/presentation';
import { athenaHref } from '@/lib/athena/query-defs';
import { useAppRouter } from '@/lib/interactions/navigation';

import { PLAN_RAIL_WIDE_PX } from './plan-panel-support';

/** The rail's empty state: one line, since the board beside it is the subject. */
const PLAN_EMPTY_STATE = { title: 'Tell Athena what this plan needs.' } as const;

/** A draft handed to the composer; each new version replaces the text and focuses the field. */
interface PlanDraftRequest {
  readonly text: string;
  readonly version: number;
}

/** Props for {@link PlanRailConversation}. */
export interface PlanRailConversationProps {
  readonly orgId: string;
}

/** The rail's Athena panel while a plan is open: the mark, a way to the full page, and the thread. */
export function PlanRailConversation({ orgId }: PlanRailConversationProps): JSX.Element {
  const { launchDraft } = useAthenaPanel();
  const [draftRequest, setDraftRequest] = useState<PlanDraftRequest | null>(null);
  // An "open Athena" with an opening line leaves it as the launch draft; the thread's composer
  // takes it from there.
  useEffect(() => {
    if (launchDraft === null || launchDraft === '') return;
    setDraftRequest((current) => ({ text: launchDraft, version: (current?.version ?? 0) + 1 }));
  }, [launchDraft]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 shrink-0 items-center gap-2 py-1 pr-1 pl-3">
        <Sparkles aria-hidden="true" className="text-primary size-4" />
        <span className="text-on-surface text-label-large min-w-0 flex-1 truncate">Athena</span>
        <Button variant="ghost" size="sm" iconOnly asChild>
          <Link
            href={athenaHref({ workspaceId: orgId })}
            aria-label="Open the Athena page"
            title="Open the Athena page"
          >
            <OpenInNew aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      </div>
      <AthenaConversation
        orgId={orgId}
        className="min-h-0 flex-1 px-3 pb-3"
        draftRequest={draftRequest}
        emptyState={PLAN_EMPTY_STATE}
      />
    </div>
  );
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
