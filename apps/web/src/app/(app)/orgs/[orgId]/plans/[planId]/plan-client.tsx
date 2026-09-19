'use client';

/**
 * `plans/[planId]/plan-client` — the planning canvas route.
 *
 * @remarks
 * The board runs edge to edge: the page owns its scroll, the sidebar drops to its icon rail on
 * most windows, and the conversation sits in the shell's right rail, a peer of the whole board.
 * Everything the route holds lives in `plan-route.ts`; this file says what renders in each state.
 */
import { AppBar, EmptyState, useOwnPageScroll } from '@docket/ui/components';
import { ChevronLeft, Workflow } from '@docket/ui/icons';
import {
  Button,
  Skeleton,
  Surface,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import type { PlanDraftOut } from '@docket/work/plan-draft-contract';
import { type JSX, type ReactNode, useCallback } from 'react';

import Link from '@/components/docket-link';
import PlanCanvasPanel from '@/components/plan-canvas/plan-canvas-panel';
import { usePlanAthena } from '@/components/plan-canvas/plan-conversation';
import { useAppLocation, useTypedRoute } from '@/lib/app-location';
import { useAppRouter } from '@/lib/interactions/navigation';
import { userErrorMessage } from '@/lib/problem';

import { usePlanRouteData, usePlanShellRequests } from './plan-route';

const START_QUERY = 'athena';
const START_VALUE = 'start';

/** The way back: the plan's initiative when it has one, else the initiatives list. */
function backTarget(
  orgId: string,
  plan: PlanDraftOut | undefined,
): { href: string; label: string } {
  if (plan?.rootInitiativeId) {
    return {
      href: `/orgs/${orgId}/initiatives/${plan.rootInitiativeId}`,
      label: 'Back to initiative',
    };
  }
  return { href: `/orgs/${orgId}/initiatives`, label: 'Back to initiatives' };
}

/** The back affordance the bar carries in every state. */
function BackNavigation({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" iconOnly asChild aria-label={label}>
          <Link href={href}>
            <ChevronLeft aria-hidden="true" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The page while the plan loads or could not be opened: the floating bar over a placeholder. */
function PlanRouteState({
  navigation,
  children,
}: {
  readonly navigation: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Surface tone="page" shape="none" className="relative flex h-full min-h-0 w-full flex-col">
      <div className="absolute top-2 left-2 z-(--z-canvas-chrome)">
        <AppBar presentation="floating" aria-label="Plan" title="Plan" navigation={navigation} />
      </div>
      {children}
    </Surface>
  );
}

/** The planning canvas for one plan. */
export default function PlanClient(): JSX.Element {
  const {
    params: { orgId, planId },
  } = useTypedRoute('/orgs/[orgId]/plans/[planId]');
  const router = useAppRouter();
  useOwnPageScroll();
  usePlanShellRequests();
  const { searchParams } = useAppLocation();
  const startRequested = searchParams.get(START_QUERY) === START_VALUE;
  const data = usePlanRouteData(orgId, planId);
  usePlanAthena(orgId, planId, data.plan, startRequested);
  const open = useCallback(
    (href: string) => {
      router.push(href);
    },
    [router],
  );
  const back = backTarget(orgId, data.plan);
  const navigation = <BackNavigation href={back.href} label={back.label} />;
  if (data.pending) {
    return (
      <PlanRouteState navigation={navigation}>
        <div className="relative flex-1">
          <Skeleton className="absolute inset-2 rounded-lg" />
        </div>
      </PlanRouteState>
    );
  }
  if (!data.plan) {
    return (
      <PlanRouteState navigation={navigation}>
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={Workflow}
            title="Couldn’t open this plan"
            body={userErrorMessage(data.error, 'Could not load this plan.')}
          />
        </div>
      </PlanRouteState>
    );
  }
  return (
    <Surface tone="page" shape="none" className="flex h-full min-h-0 w-full flex-col">
      <PlanCanvasPanel
        plan={data.plan}
        orgId={orgId}
        canEdit={data.canEdit}
        ops={data.ops}
        committing={data.committing}
        onCommit={data.onCommit}
        onUndoCommit={data.onUndoCommit}
        roster={data.roster}
        remoteDiff={data.remoteDiff}
        onOpen={open}
        memberOptions={data.memberOptions}
        resolveActor={data.resolveActor}
        initiativeOptions={data.initiativeOptions}
        className="min-h-0 flex-1"
        chrome={{ title: data.plan.title, navigation }}
      />
    </Surface>
  );
}
