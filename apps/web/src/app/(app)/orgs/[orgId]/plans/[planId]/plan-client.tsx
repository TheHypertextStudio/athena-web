'use client';

/**
 * `plans/[planId]/plan-client` — the planning canvas route.
 *
 * @remarks
 * Loads the plan, keeps it in step with the conversation shaping it, and composes the same
 * `AppBar` chrome the Task graph wears around {@link PlanCanvasPanel}. On arrival it reveals the
 * Athena rail, because a plan is something a person shapes by talking; every "Ask Athena" on the
 * canvas seeds that rail's composer with the node named.
 *
 * Which revisions are the person's own is tracked here so the panel can tell a local edit from
 * one Athena made: only the latter earns the enter motion and the "Athena updated" pill.
 */
import { AppBar, EmptyState, useShellSidebar } from '@docket/ui/components';
import { ChevronLeft, Sparkles, Workflow } from '@docket/ui/icons';
import {
  Button,
  Skeleton,
  Surface,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import type { PlanDraftOut, PlanOp } from '@docket/work/plan-draft-contract';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import Link from '@/components/docket-link';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import PlanCanvasPanel from '@/components/plan-canvas/plan-canvas-panel';
import { EMPTY_PLAN_DIFF, planDiff, type PlanDiff } from '@/components/plan-canvas/plan-diff';
import { api } from '@/lib/api';
import { useAppLocation, useTypedRoute } from '@/lib/app-location';
import { useAppRouter } from '@/lib/interactions/navigation';
import { useCommitPlan, usePlan, usePlanAthenaSync, usePlanOps } from '@/lib/plan-draft/defs';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';

/** The option sources the inspector's pickers need. */
const OPTION_KINDS = ['actors', 'initiatives'] as const;

/** The width at which the shell docks the rail beside main content instead of over it. */
const RAIL_BESIDE_CANVAS_QUERY = '(min-width: 1024px)';

/**
 * Below this window width the route asks the shell for its icon rail while the plan is open.
 *
 * @remarks
 * inspector. On a 1440px window the labelled sidebar leaves that board a 560px strip; the icon
 * rail gives it 200px back. The request is scoped to this route and never touches the viewer's
 * saved sidebar choice.
 */
const COMPACT_SIDEBAR_BELOW_PX = 1920;

/**
 * The query flag an entry point sets to have the rail open with an opening line on arrival.
 *
 * @remarks
 * The panel provider clears any launch draft on every navigation, so an entry point cannot seed
 * the composer and then navigate; it navigates here with this flag and the route seeds the
 * composer itself once the plan has loaded, then drops the flag from the URL.
 */
const START_QUERY = 'athena';
const START_VALUE = 'start';

/** Where the back affordance leads: the root initiative when there is one, else the list. */
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

/**
 * Tell a remote revision from one of the person's own.
 *
 * @remarks
 * Every batch the person applies resolves with the revision it produced, which is recorded here;
 * a revision that arrives without having been recorded came from Athena or a commit. The diff
 * against the last rendered document is what the panel animates.
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

/** The planning canvas for one plan. */
export default function PlanClient(): JSX.Element {
  const {
    params: { orgId, planId },
  } = useTypedRoute('/orgs/[orgId]/plans/[planId]');
  const router = useAppRouter();
  const { requestCompact } = useShellSidebar();
  useEffect(() => {
    if (window.innerWidth >= COMPACT_SIDEBAR_BELOW_PX) return undefined;
    return requestCompact();
  }, [requestCompact]);
  const { searchParams } = useAppLocation();
  const startRequested = searchParams.get(START_QUERY) === START_VALUE;
  const athena = useAthenaPanel();
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
  const canContribute = useOrgCapability(
    membersQ.data?.items ?? [],
    rolesQ.data?.items ?? [],
    'contribute',
  );
  const canEdit = canContribute && plan?.status !== 'archived';

  // A plan is shaped by talking: reveal the rail once on arrival. An entry point that already
  // seeded the rail with a draft (Plan with Athena on an initiative) has revealed it itself, and
  // revealing again would clear that draft.
  const revealed = useRef(false);
  const { openAthena, launchDraft } = athena;
  useEffect(() => {
    if (revealed.current || startRequested) return;
    revealed.current = true;
    // On a compact viewport the rail covers main content, so revealing it on arrival would hide
    // the very canvas the person came to see; there the rail stays one tap away in the shell.
    const wide = window.matchMedia(RAIL_BESIDE_CANVAS_QUERY).matches;
    if (launchDraft === null && wide) openAthena();
  }, [launchDraft, openAthena, startRequested]);

  // An entry point asked for the conversation to open with the plan: seed the composer with an
  // opening line once the plan is known, then drop the flag so a reload does not repeat it.
  useEffect(() => {
    if (!startRequested || !plan) return;
    revealed.current = true;
    openAthena(
      {
        workspaceId: orgId,
        ...(plan.rootInitiativeId
          ? { source: { type: 'initiative', id: plan.rootInitiativeId, label: plan.title } }
          : {}),
      },
      `Help me plan "${plan.title}". `,
    );
    router.replace(`/orgs/${orgId}/plans/${planId}`);
  }, [openAthena, orgId, plan, planId, router, startRequested]);

  const trackedOps = useMemo(
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
  const askAthena = useCallback(
    (text: string) => {
      openAthena(
        {
          workspaceId: orgId,
          ...(plan?.rootInitiativeId
            ? { source: { type: 'initiative', id: plan.rootInitiativeId, label: plan.title } }
            : {}),
        },
        text,
      );
    },
    [openAthena, orgId, plan?.rootInitiativeId, plan?.title],
  );
  const open = useCallback(
    (href: string) => {
      router.push(href);
    },
    [router],
  );

  const back = backTarget(orgId, plan);
  const chrome = (bar: React.ReactNode, title: string): JSX.Element => (
    <AppBar
      title={title}
      navigation={
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" iconOnly asChild aria-label={back.label}>
              <Link href={back.href}>
                <ChevronLeft aria-hidden="true" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{back.label}</TooltipContent>
        </Tooltip>
      }
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            openAthena();
          }}
        >
          <Sparkles className="size-4" /> Athena
        </Button>
      }
      controls={bar}
    />
  );

  if (planQuery.isPending) {
    return (
      <Surface tone="page" shape="none" className="flex h-full min-h-0 w-full flex-col">
        {chrome(null, 'Plan')}
        <div className="relative flex-1">
          <Skeleton className="absolute inset-2 rounded-lg" />
        </div>
      </Surface>
    );
  }
  if (planQuery.isError || !plan) {
    return (
      <Surface tone="page" shape="none" className="flex h-full min-h-0 w-full flex-col">
        {chrome(null, 'Plan')}
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={Workflow}
            title="Couldn’t open this plan"
            body={userErrorMessage(planQuery.error, 'Could not load this plan.')}
          />
        </div>
      </Surface>
    );
  }

  return (
    <Surface tone="page" shape="none" className="flex h-full min-h-0 w-full flex-col">
      <PlanCanvasPanel
        plan={plan}
        orgId={orgId}
        canEdit={canEdit}
        ops={trackedOps}
        committing={committing}
        onCommit={onCommit}
        remoteDiff={remoteDiff}
        onAskAthena={askAthena}
        onOpen={open}
        memberOptions={options.memberOptions}
        initiativeOptions={options.initiativeOptions}
        className="min-h-0 flex-1"
        renderChrome={(bar) => chrome(bar, plan.title)}
      />
    </Surface>
  );
}
