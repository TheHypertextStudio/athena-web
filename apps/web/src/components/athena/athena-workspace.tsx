'use client';

/**
 * `athena-workspace` — the wide `/athena` view: the same thread at full width, beside where past
 * and pending work are browsed.
 *
 * @remarks
 * Two columns from `@3xl` (§4.7 of `docs/superpowers/specs/2026-09-12-athena-companion-design.md`):
 * the conversation browser, the Work ledger, and the connections panel on the left; the thread and
 * its composer on the right. A job is a card inside that thread, not a separate selection — the
 * ledger's job is answering "what has Athena done for me?", not re-deriving the queue as a second
 * front door. Clicking a ledger row scrolls the thread to that job's card; when the card has not
 * mounted yet (the thread is still loading, or the row names a job outside this window), the row's
 * job is pinned above the composer instead.
 */
import { Sparkles } from '@docket/ui/icons';
import { Skeleton, Surface } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import AthenaConversation from '@/components/athena/athena-conversation';
import { AthenaConversationBrowser } from '@/components/athena/athena-conversation-browser';
import { AthenaMcpPanel } from '@/components/athena/athena-mcp-panel';
import {
  AthenaWorkLedger,
  type AthenaWorkLedgerFilter,
} from '@/components/athena/athena-work-ledger';
import { usePageContext } from '@/components/athena/page-context';
import { VoiceLaunch } from '@/components/athena/voice-launch';
import type {
  PersonalAthenaContext,
  PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';
import {
  personalAthenaQueueDef,
  personalAthenaTransport,
  type PersonalAthenaQueuePayload,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import { useLiveApiQuery } from '@/lib/query';

/** Props for {@link AthenaWorkspace}. */
export interface AthenaWorkspaceProps {
  /** A job to scroll the thread to once its card has mounted. */
  readonly initialSessionId?: string | null | undefined;
  /** Scope the queue and the thread to one workspace instead of every workspace at once. */
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

/** Every job in the queue's three lanes, flattened into one list. */
function flattenQueue(
  queue: PersonalAthenaQueuePayload | undefined,
): readonly PersonalAthenaSessionSummary[] {
  if (!queue) return [];
  return [...queue.sessions.needsYou, ...queue.sessions.working, ...queue.sessions.finished];
}

/** Scroll one job's card into view if it is currently mounted; report whether it was found. */
function scrollToMountedCard(jobId: string): boolean {
  const card = document.getElementById(`athena-job-${jobId}`);
  if (!card) return false;
  card.scrollIntoView({ block: 'center' });
  return true;
}

/**
 * Watch for a job's card to mount and scroll to it the moment it does — for the one-time
 * `initialSessionId` landing, where the thread beneath it may still be loading.
 */
function useScrollToInitialSession(initialSessionId: string | null | undefined): void {
  useEffect(() => {
    if (!initialSessionId) return;
    if (scrollToMountedCard(initialSessionId)) return;
    const observer = new MutationObserver(() => {
      if (scrollToMountedCard(initialSessionId)) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, [initialSessionId]);
}

/** Whether a job belongs to the scoped workspace, honouring either place a workspace id is kept. */
function inWorkspace(job: PersonalAthenaSessionSummary, workspaceFilter: string): boolean {
  return job.workspace?.id === workspaceFilter || job.context?.workspaceId === workspaceFilter;
}

/** The wide Athena view: the browser, the Work ledger, and connections beside the thread. */
export function AthenaWorkspace({
  initialSessionId = null,
  workspaceFilter = null,
  invocationContext = null,
  // Kept only because the route still passes it; the composer no longer needs seeding to appear.
  startNewWork: _startNewWork = false,
  transport = personalAthenaTransport,
}: AthenaWorkspaceProps): JSX.Element {
  const pageContext = usePageContext();
  const activeWorkspaceId = workspaceFilter ?? pageContext?.workspaceId ?? null;
  const queue = useLiveApiQuery(personalAthenaQueueDef(transport), 5_000);
  const [ledgerFilter, setLedgerFilter] = useState<AthenaWorkLedgerFilter>('running');
  const [pinnedJobId, setPinnedJobId] = useState<string | null>(null);
  const [contextAttached, setContextAttached] = useState(true);

  useEffect(() => {
    setContextAttached(true);
  }, [invocationContext]);

  useScrollToInitialSession(initialSessionId);

  const jobs = useMemo(() => {
    const all = flattenQueue(queue.data);
    return activeWorkspaceId ? all.filter((job) => inWorkspace(job, activeWorkspaceId)) : all;
  }, [queue.data, activeWorkspaceId]);

  const pinnedJob = useMemo(
    () => (pinnedJobId ? (jobs.find((job) => job.id === pinnedJobId) ?? null) : null),
    [jobs, pinnedJobId],
  );

  const handleLedgerOpen = useCallback((jobId: string): void => {
    if (scrollToMountedCard(jobId)) {
      setPinnedJobId(null);
      return;
    }
    setPinnedJobId(jobId);
  }, []);

  return (
    <Surface
      tone="page"
      shape="none"
      data-athena-workspace
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto @3xl:grid @3xl:grid-cols-[19rem_minmax(0,1fr)] @3xl:overflow-hidden">
        <Surface
          as="nav"
          tone="card"
          shape="none"
          aria-label="Athena work"
          className="border-outline-variant flex max-h-[40vh] shrink-0 flex-col overflow-y-auto border-b @3xl:max-h-none @3xl:border-r @3xl:border-b-0"
        >
          <div className="border-outline-variant border-b p-3">
            <AthenaConversationBrowser className="max-h-72" />
          </div>
          <div className="border-outline-variant border-b p-3">
            {queue.isPending ? (
              <div className="flex flex-col gap-2" aria-hidden="true">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : queue.isError ? (
              <p role="status" className="text-on-surface-variant text-body-small">
                Athena work is temporarily unavailable. We&apos;ll keep checking.
              </p>
            ) : (
              <AthenaWorkLedger
                jobs={jobs}
                filter={ledgerFilter}
                onFilterChange={setLedgerFilter}
                onOpen={handleLedgerOpen}
              />
            )}
          </div>
          <div className="border-outline-variant">
            <AthenaMcpPanel />
          </div>
        </Surface>

        <main className="flex min-h-[32rem] min-w-0 shrink-0 flex-col @3xl:min-h-0">
          <header className="border-outline-variant flex min-h-12 shrink-0 items-center gap-2 border-b px-4 py-2 @2xl:px-6">
            <Sparkles aria-hidden="true" className="text-primary size-4" />
            <span className="text-on-surface text-label-large min-w-0 flex-1 truncate">Athena</span>
            <VoiceLaunch workspaceId={activeWorkspaceId} />
          </header>
          {activeWorkspaceId ? (
            <AthenaConversation
              orgId={activeWorkspaceId}
              className="min-h-0 flex-1 px-4 pb-4 @2xl:px-6"
              jobs={jobs}
              transport={transport}
              context={invocationContext}
              contextAttached={contextAttached}
              onDetachContext={() => {
                setContextAttached(false);
              }}
              onAttachContext={() => {
                setContextAttached(true);
              }}
              {...(pinnedJob ? { pinnedJob } : {})}
            />
          ) : (
            <p role="status" className="text-on-surface-variant text-body-medium p-6">
              Open a workspace to talk to Athena.
            </p>
          )}
        </main>
      </div>
    </Surface>
  );
}
