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
 * front door. Clicking a ledger row asks the thread to scroll to that job's card; every queued job
 * is already merged into the thread by `mergeThreadEntries`, so the request is a scroll, never a
 * second copy of the card rendered above the composer.
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

/** Scroll one job's card into view if it is currently mounted; report whether it was found. */
function scrollToMountedCard(jobId: string): boolean {
  const card = document.getElementById(`athena-job-${jobId}`);
  if (!card) return false;
  card.scrollIntoView({ block: 'center' });
  return true;
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
  // Seeded once from `initialSessionId` on mount; after that this only ever moves through the
  // ledger's own open/scrolled cycle below.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(
    () => initialSessionId ?? null,
  );
  const [contextAttached, setContextAttached] = useState(true);

  useEffect(() => {
    setContextAttached(true);
  }, [invocationContext]);

  const jobs = useMemo(() => {
    const all = queue.data ? jobsFromQueue(queue.data) : [];
    return activeWorkspaceId ? all.filter((job) => inWorkspace(job, activeWorkspaceId)) : all;
  }, [queue.data, activeWorkspaceId]);

  // Try an immediate scroll first — the row's card is usually already mounted — and only ask the
  // thread to keep watching for it when it is not. `AthenaConversation`'s own effect handles the
  // watch: it retries as the thread's entries render, which covers a still-loading thread or a
  // job outside today's window.
  const handleLedgerOpen = useCallback((jobId: string): void => {
    if (scrollToMountedCard(jobId)) {
      setPendingScrollId(null);
      return;
    }
    setPendingScrollId(jobId);
  }, []);

  const handleScrolledToJob = useCallback((jobId: string): void => {
    setPendingScrollId((current) => (current === jobId ? null : current));
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
          className="flex max-h-[40vh] shrink-0 flex-col gap-3 overflow-y-auto @3xl:max-h-none"
        >
          <div className="p-3">
            <AthenaConversationBrowser className="max-h-72" />
          </div>
          <div className="p-3">
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
          <div>
            <AthenaMcpPanel />
          </div>
        </Surface>

        <main className="flex min-h-[32rem] min-w-0 shrink-0 flex-col @3xl:min-h-0">
          <Surface
            as="header"
            tone="card"
            shape="none"
            className="flex min-h-12 shrink-0 items-center gap-2 px-4 py-2 @2xl:px-6"
          >
            <Sparkles aria-hidden="true" className="text-primary size-4" />
            <span className="text-on-surface text-label-large min-w-0 flex-1 truncate">Athena</span>
            <VoiceLaunch workspaceId={activeWorkspaceId} />
          </Surface>
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
              questions={false}
              scrollToJobId={pendingScrollId}
              onScrolledToJob={handleScrolledToJob}
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
