'use client';

/**
 * `athena-workspace` — the wide `/athena` view: history on the left, the conversation on the right.
 *
 * @remarks
 * Two columns from the `xl` viewport breakpoint (§4.7 of
 * `docs/superpowers/specs/2026-09-12-athena-companion-design.md`), not a container query, so the
 * view is wide whether or not a rail panel is open beside it. The left column holds the
 * conversation browser and then the Work ledger; the right column holds the thread under a 44px
 * header with the page chip and Talk — the same header the rail panel has, and the only one on the
 * screen, because the shell drops Athena's rail panel on this route.
 *
 * Every piece of delegated work lives in the ledger, and only there: the thread on this page carries
 * the conversation (messages, questions, plans) and merges no jobs, so no job has two live copies in
 * the document. There is no connections band — the composer's attach control and Settings ›
 * Connections own connecting an app.
 */
import { Skeleton, Surface } from '@docket/ui/primitives';
import { type JSX, useEffect, useMemo, useState } from 'react';

import AthenaConversation from '@/components/athena/athena-conversation';
import { AthenaConversationBrowser } from '@/components/athena/athena-conversation-browser';
import {
  AthenaWorkLedger,
  type AthenaWorkLedgerFilter,
  ledgerFilterOf,
} from '@/components/athena/athena-work-ledger';
import { usePageContext } from '@/components/athena/page-context';
import { VoiceLaunch } from '@/components/athena/voice-launch';
import { jobsFromQueue } from '@/lib/athena/job-presentation';
import type {
  PersonalAthenaContext,
  PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';
import {
  personalAthenaQueueDef,
  personalAthenaTransport,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import { useLiveApiQuery } from '@/lib/query';

/** Props for {@link AthenaWorkspace}. */
export interface AthenaWorkspaceProps {
  /** A job to open the ledger on and scroll to once its entry has mounted. */
  readonly initialSessionId?: string | null | undefined;
  /** Scope the ledger and the thread to one workspace instead of the page's own. */
  readonly workspaceFilter?: string | null | undefined;
  /** The page context an entry point opened this view with; attached to the next message. */
  readonly invocationContext?: PersonalAthenaContext | null | undefined;
  /**
   * Retained for callers still passing it; the composer is always present now, so there is nothing
   * left for this to seed.
   */
  readonly startNewWork?: boolean | undefined;
  readonly transport?: PersonalAthenaTransport | undefined;
}

/** How often the ledger re-reads the workspace's queue. */
const QUEUE_LIVE_INTERVAL_MS = 5_000;

/** The thread on this page merges no jobs: they live in the ledger. */
const NO_JOBS: readonly PersonalAthenaSessionSummary[] = [];

/**
 * Scroll one job's ledger entry into view; report whether it was mounted.
 *
 * @remarks
 * Queries inside `[data-athena-workspace]`, never the whole document, so another copy of the same
 * job elsewhere on the page is never the one that moves.
 */
function scrollToLedgerEntry(jobId: string): boolean {
  const entry = document.querySelector(`[data-athena-workspace] [data-athena-job="${jobId}"]`);
  entry?.scrollIntoView({ block: 'center' });
  return entry !== null;
}

/** The ledger's chosen filter, and the job a link asked the page to open on. */
interface LedgerFocus {
  readonly filter: AthenaWorkLedgerFilter;
  readonly setFilter: (filter: AthenaWorkLedgerFilter) => void;
}

/**
 * Hold the ledger's filter, and honour a link's `session` once: switch to that job's filter and
 * scroll to its entry as soon as it renders.
 */
function useLedgerFocus(
  initialSessionId: string | null,
  jobs: readonly PersonalAthenaSessionSummary[],
): LedgerFocus {
  // Waiting work first; the ledger falls back to the next filter with work when this one is empty.
  const [filter, setFilter] = useState<AthenaWorkLedgerFilter>('needs_you');
  const [pendingId, setPendingId] = useState<string | null>(initialSessionId);
  const target = pendingId ? jobs.find((job) => job.id === pendingId) : undefined;
  if (target && ledgerFilterOf(target) !== filter) setFilter(ledgerFilterOf(target));
  useEffect(() => {
    if (target && scrollToLedgerEntry(target.id)) setPendingId(null);
  }, [target, filter]);
  return { filter, setFilter };
}

/** Where the queue read stands, for the ledger's loading and failure lines. */
interface QueueReadState {
  readonly isPending: boolean;
  readonly isError: boolean;
}

/** Props for {@link WorkColumn}. */
interface WorkColumnProps {
  readonly queue: QueueReadState;
  readonly jobs: readonly PersonalAthenaSessionSummary[];
  readonly focus: LedgerFocus;
  readonly transport: PersonalAthenaTransport;
}

/** The left column: the conversation browser, then the Work ledger. */
function WorkColumn({ queue, jobs, focus, transport }: WorkColumnProps): JSX.Element {
  return (
    <Surface
      as="nav"
      tone="card"
      shape="none"
      aria-label="Athena work"
      className="flex max-h-40 shrink-0 flex-col gap-8 overflow-y-auto p-4 2xl:max-h-none 2xl:min-h-0"
    >
      <AthenaConversationBrowser className="max-h-72" />
      <WorkLedgerRead queue={queue} jobs={jobs} focus={focus} transport={transport} />
    </Surface>
  );
}

/** The ledger once the queue has loaded; a skeleton before, and one line if the read fails. */
function WorkLedgerRead({ queue, jobs, focus, transport }: WorkColumnProps): JSX.Element | null {
  if (queue.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (queue.isError) {
    return (
      <p role="status" className="text-on-surface-variant text-body-small">
        Work is temporarily unavailable. We&apos;ll keep checking.
      </p>
    );
  }
  return (
    <AthenaWorkLedger
      jobs={jobs}
      filter={focus.filter}
      onFilterChange={focus.setFilter}
      transport={transport}
    />
  );
}

/** Props for {@link ThreadColumn}. */
interface ThreadColumnProps {
  readonly workspaceId: string | null;
  /** The context a link opened this view with, else the page's own workspace. */
  readonly invocationContext: PersonalAthenaContext | null;
  readonly transport: PersonalAthenaTransport;
}

/** The right column: the conversation and its context-aware composer. */
function ThreadColumn({
  workspaceId,
  invocationContext,
  transport,
}: ThreadColumnProps): JSX.Element {
  const [contextAttached, setContextAttached] = useState(true);
  useEffect(() => {
    setContextAttached(true);
  }, [invocationContext]);

  if (!workspaceId) {
    return (
      <section aria-label="Conversation" className="flex min-w-0 flex-col">
        <p role="status" className="text-on-surface-variant text-body-medium p-6">
          Open a workspace to talk to Athena.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-label="Conversation"
      className="flex min-h-[32rem] min-w-0 flex-1 flex-col 2xl:min-h-0"
    >
      <h1 className="sr-only">Athena conversation</h1>
      <AthenaConversation
        orgId={workspaceId}
        layout="page"
        talk={<VoiceLaunch workspaceId={workspaceId} iconOnly />}
        composerChip
        className="min-h-0 flex-1 px-4 pb-4 xl:px-8"
        jobs={NO_JOBS}
        transport={transport}
        context={invocationContext}
        contextAttached={contextAttached}
        onDetachContext={() => {
          setContextAttached(false);
        }}
        onAttachContext={() => {
          setContextAttached(true);
        }}
      />
    </section>
  );
}

/** The wide Athena view: the browser and the Work ledger beside the conversation. */
export function AthenaWorkspace({
  initialSessionId = null,
  workspaceFilter = null,
  invocationContext = null,
  // Kept only because the route still passes it; the composer no longer needs seeding to appear.
  startNewWork: _startNewWork = false,
  transport = personalAthenaTransport,
}: AthenaWorkspaceProps): JSX.Element {
  const pageContext = usePageContext();
  const workspaceId = workspaceFilter ?? pageContext?.workspaceId ?? null;
  const queue = useLiveApiQuery(
    personalAthenaQueueDef(transport, true, workspaceId ?? undefined),
    QUEUE_LIVE_INTERVAL_MS,
  );
  const jobs = useMemo(() => (queue.data ? jobsFromQueue(queue.data) : NO_JOBS), [queue.data]);
  const focus = useLedgerFocus(initialSessionId, jobs);

  return (
    <Surface
      tone="page"
      shape="none"
      data-athena-workspace
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto 2xl:grid 2xl:grid-cols-[minmax(18rem,21rem)_minmax(24rem,1fr)] 2xl:overflow-hidden">
        <WorkColumn queue={queue} jobs={jobs} focus={focus} transport={transport} />
        <ThreadColumn
          workspaceId={workspaceId}
          invocationContext={invocationContext ?? pageContext}
          transport={transport}
        />
      </div>
    </Surface>
  );
}
