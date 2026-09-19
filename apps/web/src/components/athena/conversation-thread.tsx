'use client';

/**
 * The Athena conversation's one scrolling region: every entry, bottom-aligned.
 *
 * @remarks
 * Split out of `athena-conversation.tsx`. Only the header and the composer may live outside this
 * scroller, so everything else the thread shows — work entries, questions, and the heads-up — is an
 * entry inside it, in the thread's own order. A failed send is reported once, as a notice. Entries sit 32px apart and
 * are bottom-aligned, so a short thread rests just above the composer.
 *
 * Every lookup (jump to a waiting entry, a heads-up's Review, a ledger row's request) queries this
 * scroller rather than the document, so a second copy of the same entry elsewhere on the page is
 * never the one that moves.
 */
import type { AgentSessionDetailOut } from '@docket/athena/agent-contract';
import { ChevronDown } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import type { UseQueryResult } from '@tanstack/react-query';
import { type JSX, type RefObject, useEffect, useRef, useState } from 'react';

import { ProposalGroupCard } from '@/components/agents/proposal-group-card';
import { PartialLoadBanner, QueryLoadFailure } from '@/components/feedback';
import { ConversationSuggestions } from '@/components/athena/conversation-suggestions';
import { AthenaHeadsUpSlot } from '@/components/athena/heads-up-entry';
import { ThreadEntries } from '@/components/athena/thread-entries';
import type { HeadsUp } from '@/lib/athena/heads-ups';
import type { ThreadEntry } from '@/lib/athena/job-presentation';
import type { PersonalAthenaContext } from '@/lib/athena/presentation';
import type { PersonalAthenaTransport } from '@/lib/athena/query-defs';
import { useSessionDetail } from '@/lib/use-session-detail';

/** Find one job's entry inside a scroller, never elsewhere in the document. */
function jobEntryIn(scroller: HTMLElement | null, jobId: string): HTMLElement | null {
  return scroller?.querySelector<HTMLElement>(`[data-athena-job="${jobId}"]`) ?? null;
}

/**
 * Scroll one job's entry into view inside `scroller`.
 *
 * @returns whether the entry was mounted there.
 */
export function scrollToJobIn(scroller: HTMLElement | null, jobId: string): boolean {
  const entry = jobEntryIn(scroller, jobId);
  entry?.scrollIntoView({ block: 'center' });
  return entry !== null;
}

/** Which waiting entry the observer last reported on, and whether it was out of view. */
interface WaitingVisibility {
  readonly jobId: string | null;
  readonly outOfView: boolean;
}

/**
 * Whether the waiting entry named by `jobId` is scrolled out of the scroller's view.
 *
 * @remarks
 * Watched with an `IntersectionObserver` rooted on the scroller, so the answer follows scrolling
 * and resizing without a scroll listener. The report is keyed by job id so a stale answer about a
 * previous waiting entry never shows the jump for a new one.
 */
function useWaitingOutOfView(
  scrollerRef: RefObject<HTMLDivElement | null>,
  jobId: string | null,
  entryCount: number,
): boolean {
  const [visibility, setVisibility] = useState<WaitingVisibility>({
    jobId: null,
    outOfView: false,
  });
  useEffect(() => {
    const scroller = scrollerRef.current;
    const target = jobId ? jobEntryIn(scroller, jobId) : null;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([record]) => {
        setVisibility({ jobId, outOfView: record ? !record.isIntersecting : false });
      },
      { root: scroller },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [scrollerRef, jobId, entryCount]);
  return jobId !== null && visibility.jobId === jobId && visibility.outOfView;
}

/** Props for {@link ChatProposals}. */
interface ChatProposalsProps {
  readonly orgId: string;
  readonly sessionId: string;
  readonly onSettled: () => Promise<void>;
}

/** The in-thread ghost review: the thread's pending batches, decidable in place. */
function ChatProposals({ orgId, sessionId, onSettled }: ChatProposalsProps): JSX.Element | null {
  const { proposals, decideGroup, editProposal, controlPending } = useSessionDetail(
    orgId,
    sessionId,
  );
  const groupRef = useRef<HTMLDivElement | null>(null);

  // The proposal group loads via its own fetch, after the thread's scroll-to-end has already run,
  // so without this the pending approval would render below the fold.
  useEffect(() => {
    if (proposals.length > 0) groupRef.current?.scrollIntoView({ block: 'end' });
  }, [proposals.length]);

  if (proposals.length === 0) return null;
  return (
    <div ref={groupRef} className="flex flex-col gap-3">
      {proposals.map((group) => (
        <ProposalGroupCard
          key={group.proposalGroupId}
          group={group}
          canAct
          pending={controlPending}
          onDecide={(groupId, decision, activityIds) => {
            void decideGroup(groupId, decision, activityIds).then(onSettled);
          }}
          onEdit={(activityId, input) => {
            void editProposal(activityId, input);
          }}
        />
      ))}
    </div>
  );
}

/** Props for {@link ConversationThread}. */
export interface ConversationThreadProps {
  /** The thread's own read: pending placeholder, first-read failure, or a failed refresh. */
  readonly query: UseQueryResult<AgentSessionDetailOut>;
  /** The thread's activities, jobs, and questions, merged and ordered. */
  readonly entries: readonly ThreadEntry[];
  /** The thread itself, once loaded — carries the id and status {@link ChatProposals} needs. */
  readonly thread: AgentSessionDetailOut | null;
  readonly orgId: string;
  readonly transport: PersonalAthenaTransport;
  readonly sendWidgetMessage: (text: string) => Promise<boolean>;
  readonly reloadWithTransition: () => Promise<void>;
  /** A one-line label an empty thread shows above its suggestions, from a host with a subject. */
  readonly emptyLabel: string | undefined;
  readonly suggestions: boolean;
  readonly context: PersonalAthenaContext | null;
  readonly onPickSuggestion: (prompt: string) => void;
  /** Every heads-up the thread's jobs qualify for, and the one already closed. */
  readonly headsUps: readonly HeadsUp[];
  readonly closedHeadsUpId: string | null;
  readonly onDismissHeadsUp: (id: string) => void;
  /** The first job waiting on the person, for the jump control. */
  readonly waitingJobId: string | null;
  /** The question a notification landed on. */
  readonly landingQuestionId: string | null;
  /** A job the host wants scrolled to, and the report that it was. */
  readonly scrollToJobId: string | null;
  readonly onScrolledToJob: ((jobId: string) => void) | undefined;
}

/** Props for {@link ThreadBody}. */
type ThreadBodyProps = Omit<
  ConversationThreadProps,
  | 'headsUps'
  | 'closedHeadsUpId'
  | 'onDismissHeadsUp'
  | 'waitingJobId'
  | 'scrollToJobId'
  | 'onScrolledToJob'
>;

/**
 * The thread's history: a loading skeleton, the first read's failure, or the merged entries or
 * empty suggestions under a banner when a later refresh failed.
 */
function ThreadBody({
  query,
  entries,
  thread,
  orgId,
  transport,
  sendWidgetMessage,
  reloadWithTransition,
  emptyLabel,
  suggestions,
  context,
  onPickSuggestion,
  landingQuestionId,
}: ThreadBodyProps): JSX.Element {
  if (thread === null && query.isPending) {
    return (
      <div className="flex flex-col gap-3 pl-6" aria-hidden="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    );
  }
  if (thread === null && query.isError) {
    return <QueryLoadFailure title="Conversation" query={query} size="panel" />;
  }
  const refreshFailed = query.isError ? (
    <PartialLoadBanner
      title="Could not refresh the conversation"
      onRetry={() => void query.refetch()}
    />
  ) : null;
  if (entries.length > 0) {
    return (
      <>
        {refreshFailed}
        <ThreadEntries
          entries={entries}
          workspaceId={orgId}
          landingQuestionId={landingQuestionId}
          transport={transport}
          onWidgetMessage={sendWidgetMessage}
        />
        {thread?.status === 'awaiting_approval' ? (
          <ChatProposals orgId={orgId} sessionId={thread.id} onSettled={reloadWithTransition} />
        ) : null}
      </>
    );
  }
  return (
    <>
      {refreshFailed}
      <div className="flex flex-col gap-1">
        {emptyLabel ? (
          <p className="text-on-surface-variant text-body-medium px-3">{emptyLabel}</p>
        ) : null}
        {suggestions ? (
          <ConversationSuggestions context={context} onPick={onPickSuggestion} />
        ) : null}
      </div>
    </>
  );
}

/** Props for {@link JumpToWaiting}. */
interface JumpToWaitingProps {
  readonly onJump: () => void;
}

/** The floating jump to the entry waiting on the person, shown only while it is out of view. */
function JumpToWaiting({ onJump }: JumpToWaitingProps): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
      <Button
        type="button"
        variant="secondary"
        controlSize="sm"
        data-slot="athena-jump-to-waiting"
        className="pointer-events-auto"
        onClick={onJump}
      >
        <ChevronDown aria-hidden="true" />
        Waiting on you
      </Button>
    </div>
  );
}

/**
 * The thread's scroller: bottom-aligned entries 32px apart, the heads-up at the
 * bottom, and a floating jump to a waiting entry scrolled out of view.
 */
export function ConversationThread(props: ConversationThreadProps): JSX.Element {
  const { entries, headsUps, closedHeadsUpId, onDismissHeadsUp, waitingJobId } = props;
  const { scrollToJobId, onScrolledToJob, landingQuestionId } = props;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Keyed on the loading flag too: entries render only once the thread's own read settles.
  const renderedCount = props.query.isPending ? 0 : entries.length;
  const waitingOutOfView = useWaitingOutOfView(scrollerRef, waitingJobId, renderedCount);

  // Newest at the bottom: a new entry scrolls the thread to its end, inside the scroller only.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [renderedCount]);

  // Honour a host's request to jump to one job's entry. The entry may not be mounted yet (the
  // thread is still loading); the request then stays pending until `entries` changes.
  useEffect(() => {
    if (!scrollToJobId) return;
    if (scrollToJobIn(scrollerRef.current, scrollToJobId)) onScrolledToJob?.(scrollToJobId);
  }, [scrollToJobId, entries, onScrolledToJob]);

  useEffect(() => {
    if (!landingQuestionId) return;
    scrollerRef.current
      ?.querySelector(`[data-elicitation="${landingQuestionId}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [landingQuestionId, entries.length]);

  function jumpTo(jobId: string): void {
    scrollToJobIn(scrollerRef.current, jobId);
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollerRef} data-slot="athena-thread" className="absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end gap-8 py-4">
          <ThreadBody {...props} />
          <AthenaHeadsUpSlot
            headsUps={headsUps}
            closedId={closedHeadsUpId}
            onReview={jumpTo}
            onDismiss={onDismissHeadsUp}
          />
        </div>
      </div>
      {waitingJobId && waitingOutOfView ? (
        <JumpToWaiting
          onJump={() => {
            jumpTo(waitingJobId);
          }}
        />
      ) : null}
    </div>
  );
}
