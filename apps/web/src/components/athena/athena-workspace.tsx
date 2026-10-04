'use client';

/** One ongoing conversation with compact navigation to delegated work. */
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Skeleton,
  Surface,
} from '@docket/ui/primitives';
import { type JSX, useEffect, useMemo, useState } from 'react';

import AthenaConversation from '@/components/athena/athena-conversation';
import {
  AthenaWorkLedger,
  type AthenaWorkLedgerFilter,
  ledgerFilterOf,
  resolveLedgerFilter,
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
  /** A job to select and reveal in the conversation once its entry has mounted. */
  readonly initialSessionId?: string | null | undefined;
  /** One message selected through the app's search control. */
  readonly initialActivityId?: string | null | undefined;
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

/** Stable empty job list before the queue loads. */
const NO_JOBS: readonly PersonalAthenaSessionSummary[] = [];

/** Work navigation and the entry the conversation should reveal. */
interface LedgerFocus {
  readonly filter: AthenaWorkLedgerFilter;
  readonly setFilter: (filter: AthenaWorkLedgerFilter) => void;
  readonly selected: PersonalAthenaSessionSummary | undefined;
  readonly scrollId: string | null;
  readonly select: (id: string) => void;
  readonly scrolled: () => void;
}

/** Keep selection separate from queue updates, so reviewing work never loses its place. */
function useLedgerFocus(
  initialSessionId: string | null,
  jobs: readonly PersonalAthenaSessionSummary[],
): LedgerFocus {
  const [filter, setFilter] = useState<AthenaWorkLedgerFilter>('needs_you');
  const [selectedId, setSelectedId] = useState(initialSessionId);
  const [scrollId, setScrollId] = useState(initialSessionId);
  const linked =
    scrollId === initialSessionId ? jobs.find((job) => job.id === initialSessionId) : undefined;
  const activeFilter = linked ? ledgerFilterOf(linked) : filter;
  const active = resolveLedgerFilter(jobs, activeFilter);
  const selected =
    jobs.find((job) => job.id === selectedId) ?? jobs.find((job) => ledgerFilterOf(job) === active);
  useEffect(() => {
    if (selected && selected.id !== selectedId) {
      setSelectedId(selected.id);
      setScrollId(selected.id);
    }
  }, [selected, selectedId]);
  return {
    filter: activeFilter,
    selected,
    scrollId,
    setFilter: (next) => {
      setFilter(next);
      const first = jobs.find((job) => ledgerFilterOf(job) === next);
      setSelectedId(first?.id ?? null);
      setScrollId(first?.id ?? null);
    },
    select: (id) => {
      setSelectedId(id);
      setScrollId(id);
    },
    scrolled: () => {
      setFilter(activeFilter);
      setScrollId(null);
    },
  };
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

/** A compact sidebar on desktop, and an expandable work picker on a phone. */
function WorkColumn({ queue, jobs, focus, transport }: WorkColumnProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Surface
      as="nav"
      tone="card"
      shape="none"
      aria-label="Athena work"
      className="min-h-0 shrink-0 md:w-60 md:overflow-y-auto"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="min-h-10 w-full justify-between px-4 md:hidden">
            <span>Work</span>
            <span className="text-on-surface-variant text-label-small">
              {open ? 'Hide' : 'Browse'}
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent
          forceMount
          className="hidden max-h-72 overflow-y-auto p-4 data-[state=open]:block md:block md:max-h-none"
        >
          <WorkLedgerRead
            queue={queue}
            jobs={jobs}
            focus={{
              ...focus,
              select: (id) => {
                focus.select(id);
                setOpen(false);
              },
            }}
            transport={transport}
          />
        </CollapsibleContent>
      </Collapsible>
    </Surface>
  );
}

/** The ledger once the queue has loaded; a skeleton before, and one line if the read fails. */
function WorkLedgerRead({ queue, jobs, focus }: WorkColumnProps): JSX.Element | null {
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
        Work is unavailable.
      </p>
    );
  }
  return (
    <AthenaWorkLedger
      jobs={jobs}
      filter={focus.filter}
      onFilterChange={focus.setFilter}
      selectedId={focus.selected?.id}
      onSelect={focus.select}
    />
  );
}

/** Props for {@link ThreadColumn}. */
interface ThreadColumnProps {
  readonly workspaceId: string | null;
  /** The context a link opened this view with, else the page's own workspace. */
  readonly invocationContext: PersonalAthenaContext | null;
  readonly transport: PersonalAthenaTransport;
  readonly initialActivityId: string | null;
  readonly focus: LedgerFocus;
}

/** The right column: the conversation and its context-aware composer. */
function ThreadColumn({
  workspaceId,
  invocationContext,
  transport,
  initialActivityId,
  focus,
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
    <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <h1 className="sr-only">Athena conversation</h1>
      <AthenaConversation
        orgId={workspaceId}
        layout="page"
        talk={<VoiceLaunch workspaceId={workspaceId} iconOnly />}
        composerChip
        jobReminders={false}
        focusedJobId={focus.selected?.id}
        className="min-h-0 flex-1 px-4 pb-4 xl:px-8"
        jobs={focus.selected ? [focus.selected] : NO_JOBS}
        scrollToJobId={focus.scrollId}
        onScrolledToJob={focus.scrolled}
        transport={transport}
        context={invocationContext}
        contextAttached={contextAttached}
        onDetachContext={() => {
          setContextAttached(false);
        }}
        onAttachContext={() => {
          setContextAttached(true);
        }}
        jumpToActivityId={initialActivityId}
      />
    </section>
  );
}

/** The wide Athena view keeps the conversation primary and shows delegated work when relevant. */
export function AthenaWorkspace({
  initialSessionId = null,
  initialActivityId = null,
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
  const hasWork = jobs.length > 0;

  return (
    <Surface
      tone="page"
      shape="none"
      data-athena-workspace
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {hasWork ? (
          <WorkColumn queue={queue} jobs={jobs} focus={focus} transport={transport} />
        ) : null}
        <ThreadColumn
          workspaceId={workspaceId}
          invocationContext={invocationContext ?? pageContext}
          transport={transport}
          initialActivityId={initialActivityId}
          focus={focus}
        />
      </div>
    </Surface>
  );
}
