'use client';

/**
 * The Athena conversation's one scrolling region: history, local progress, and recovery.
 *
 * @remarks
 * Split out of `athena-conversation.tsx`. Only the header and the composer may live outside this
 * scroller, so everything else the thread shows — work entries, questions, and the heads-up — is an
 * entry inside it, in the thread's own order. A failed send stays in the thread with recovery
 * guidance. The page reads from the top; the compact panel keeps the latest turn by its composer.
 *
 * Every lookup (jump to a waiting entry, a heads-up's Review, a ledger row's request) queries this
 * scroller rather than the document, so a second copy of the same entry elsewhere on the page is
 * never the one that moves.
 */
import type { AgentSessionDetailOut } from '@docket/athena/agent-contract';
import { ChevronDown, Sparkles } from '@docket/ui/icons';
import { InlineBanner } from '@docket/ui/components';
import { Button, Skeleton, Surface } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { UseQueryResult } from '@tanstack/react-query';
import { type JSX, type RefObject, useEffect, useRef, useState } from 'react';

import { ProposalGroupCard } from '@/components/agents/proposal-group-card';
import { PartialLoadBanner, QueryLoadFailure } from '@/components/feedback';
import { ConversationSuggestions } from '@/components/athena/conversation-suggestions';
import { AthenaHeadsUpSlot } from '@/components/athena/heads-up-entry';
import { ThreadEntries } from '@/components/athena/thread-entries';
import { UserMessage } from '@/components/athena/thread-entries';
import type { PendingTurn } from '@/components/athena/athena-conversation';
import Link from '@/components/docket-link';
import type { HeadsUp } from '@/lib/athena/heads-ups';
import type { ThreadEntry } from '@/lib/athena/job-presentation';
import type { PersonalAthenaContext } from '@/lib/athena/presentation';
import type { PersonalAthenaTransport } from '@/lib/athena/query-defs';
import { useSessionDetail } from '@/lib/use-session-detail';
import { failureAction, type FailurePresentation } from '@/lib/failure-presentation';

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

/** How close to the end, in px, still counts as reading the newest entry. */
const STICK_TO_END_SLACK_PX = 48;

/**
 * Keep the thread at its end while its content grows, as long as the person was already there.
 *
 * @remarks
 * Entries finish their layout after they first render — a work entry's detail read, a question's
 * controls — so a single scroll on each new entry left the newest ones below the fold. A
 * `ResizeObserver` on the content column re-pins the end whenever it grows, and only when the
 * scroller was at (or within {@link STICK_TO_END_SLACK_PX} of) the end, so someone reading back is
 * never pulled down.
 */
function useStickToEnd(
  scrollerRef: RefObject<HTMLDivElement | null>,
  columnRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const scroller = scrollerRef.current;
    const column = columnRef.current;
    if (!scroller || !column || typeof ResizeObserver === 'undefined') return;
    let atEnd = true;
    const onScroll = (): void => {
      const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      atEnd = remaining <= STICK_TO_END_SLACK_PX;
    };
    const observer = new ResizeObserver(() => {
      if (atEnd) scroller.scrollTop = scroller.scrollHeight;
    });
    scroller.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(column);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [scrollerRef, columnRef]);
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
  readonly layout?: 'page' | 'panel';
  readonly pendingTurn?: PendingTurn | null;
  readonly sendFailure?: FailurePresentation | null;
  readonly refreshDelayed?: boolean;
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
function ThreadBody(props: ThreadBodyProps): JSX.Element {
  const { query, thread } = props;
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
  return (
    <>
      {query.isError ? (
        <PartialLoadBanner
          title="Could not refresh the conversation"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      <ThreadContent {...props} />
    </>
  );
}

/** Avoid showing a second copy once a streamed or polled activity records this send. */
function optimisticTextFor(
  pendingTurn: PendingTurn | null | undefined,
  thread: AgentSessionDetailOut | null,
): string | null {
  if (!pendingTurn) return null;
  const recorded = thread?.activities.some(
    (activity) =>
      !pendingTurn.knownActivityIds.has(activity.id) &&
      activity.type === 'response' &&
      activity.body['author'] === 'user' &&
      activity.body['text'] === pendingTurn.text,
  );
  return recorded ? null : pendingTurn.text;
}

/** The settled entries plus any local progress, or suggestions before the first turn. */
function ThreadContent(props: ThreadBodyProps): JSX.Element {
  const showWorking = shouldShowWorking(props.pendingTurn, props.thread);
  if (hasConversationContent(props.entries, showWorking, props.sendFailure)) {
    return <ConversationHistory {...props} showWorking={showWorking} />;
  }
  return <EmptyConversation {...props} />;
}

/** Saved entries, local progress, and any reply outcome in chronological order. */
function ConversationHistory({
  entries,
  thread,
  orgId,
  transport,
  sendWidgetMessage,
  reloadWithTransition,
  landingQuestionId,
  pendingTurn,
  sendFailure,
  refreshDelayed,
  showWorking,
}: ThreadBodyProps & { readonly showWorking: boolean }): JSX.Element {
  const optimisticText = optimisticTextFor(pendingTurn, thread);
  return (
    <>
      <ThreadEntries
        entries={entries}
        workspaceId={orgId}
        landingQuestionId={landingQuestionId}
        transport={transport}
        onWidgetMessage={sendWidgetMessage}
      />
      {optimisticText ? <UserMessage text={optimisticText} /> : null}
      {showWorking ? <AthenaWorking /> : null}
      {refreshDelayed ? (
        <p role="status" className="text-on-surface-variant text-body-small">
          Message sent. The conversation could not refresh yet. We&apos;ll keep checking.
        </p>
      ) : null}
      {sendFailure ? <SendFailure failure={sendFailure} /> : null}
      {!sendFailure && isUnansweredFailure(thread) ? <UnansweredFailure /> : null}
      {thread?.status === 'awaiting_approval' ? (
        <ChatProposals orgId={orgId} sessionId={thread.id} onSettled={reloadWithTransition} />
      ) : null}
    </>
  );
}

/** A compact start in the rail and a focused starting point on the page. */
function EmptyConversation({
  emptyLabel,
  suggestions,
  context,
  onPickSuggestion,
  layout,
}: ThreadBodyProps): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1', layout === 'page' && 'my-auto w-full')}>
      {emptyLabel ? (
        <p className="text-on-surface-variant text-body-medium px-3">{emptyLabel}</p>
      ) : null}
      {suggestions ? (
        <ConversationSuggestions context={context} onPick={onPickSuggestion} layout={layout} />
      ) : null}
    </div>
  );
}

/** Suggestions appear only before there is a turn or a send outcome to show. */
function hasConversationContent(
  entries: readonly ThreadEntry[],
  working: boolean,
  failure: FailurePresentation | null | undefined,
): boolean {
  return entries.length > 0 || working || failure != null;
}

/** Local sends and server-side running turns share one progress presentation. */
function shouldShowWorking(
  pendingTurn: PendingTurn | null | undefined,
  thread: AgentSessionDetailOut | null,
): boolean {
  return pendingTurn != null || isWaitingForAthena(thread);
}

/** A failed run with a saved prompt still needs a visible conclusion after reload. */
function isUnansweredFailure(thread: AgentSessionDetailOut | null): boolean {
  if (thread?.status !== 'failed') return false;
  let latestUser = -1;
  let latestAnswer = -1;
  thread.activities.forEach((activity, index) => {
    if (activity.type !== 'response') return;
    if (activity.body['author'] === 'user') latestUser = index;
    else latestAnswer = index;
  });
  return latestUser > latestAnswer;
}

/** A durable failure gives the saved message a clear outcome and next step. */
function UnansweredFailure(): JSX.Element {
  return (
    <InlineBanner tone="critical" title="Athena couldn't finish this reply.">
      Your message is saved. Check your connection and send a follow-up when Athena is available.
    </InlineBanner>
  );
}

/** A persisted user turn without a reply keeps its progress visible across reloads. */
function isWaitingForAthena(thread: AgentSessionDetailOut | null): boolean {
  if (!thread || !['pending', 'running'].includes(thread.status)) return false;
  let latestUser = -1;
  let latestReply = -1;
  thread.activities.forEach((activity, index) => {
    if (activity.type === 'response') {
      if (activity.body['author'] === 'user') latestUser = index;
      else latestReply = index;
    }
    if (activity.type === 'error') latestReply = index;
  });
  return latestUser > latestReply;
}

/** A specific, live response state instead of a cleared composer and an empty page. */
function AthenaWorking(): JSX.Element {
  return (
    <div role="status" aria-live="polite" className="flex items-start gap-3">
      <span
        className="bg-secondary-container text-on-secondary-container flex size-8 shrink-0 items-center justify-center rounded-full"
        aria-hidden="true"
      >
        <Sparkles className="size-4" />
      </span>
      <Surface tone="card" shape="large" pad="roomy">
        <p className="text-on-surface text-body-medium">
          Athena is working
          <span
            aria-hidden="true"
            className="inline-block animate-pulse motion-reduce:animate-none"
          >
            …
          </span>
        </p>
        <p className="text-on-surface-variant text-body-small mt-1">
          Your message is in the conversation. The answer will appear here.
        </p>
      </Surface>
    </div>
  );
}

/** Keep send errors in context, with the original draft still available in the composer. */
function SendFailure({ failure }: { readonly failure: FailurePresentation }): JSX.Element {
  const destination = failureAction(failure);
  return (
    <InlineBanner tone="critical" title={failure.title}>
      <p>{failure.detail}</p>
      <p className="mt-2">
        Your draft is still in the composer. Check the conversation before sending it again.
      </p>
      {destination ? (
        <Link href={destination.href} className="mt-2 inline-block underline">
          {destination.label}
        </Link>
      ) : null}
    </InlineBanner>
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
 * The thread's scroller, with the heads-up and jump to waiting work inside its own frame.
 */
export function ConversationThread(props: ConversationThreadProps): JSX.Element {
  const { entries, headsUps, closedHeadsUpId, onDismissHeadsUp, waitingJobId } = props;
  const { scrollToJobId, onScrolledToJob, landingQuestionId } = props;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  // Keyed on the loading flag too: entries render only once the thread's own read settles.
  const renderedCount = props.query.isPending ? 0 : entries.length;
  const waitingOutOfView = useWaitingOutOfView(scrollerRef, waitingJobId, renderedCount);

  // Newest at the bottom: a new entry scrolls the thread to its end, inside the scroller only.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [renderedCount, props.pendingTurn, props.sendFailure]);
  useStickToEnd(scrollerRef, columnRef);

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
        <div
          ref={columnRef}
          className={cn(
            'flex min-h-full flex-col gap-7 py-4',
            props.layout === 'page'
              ? 'mx-auto w-full max-w-3xl justify-start pt-8 pb-12'
              : 'justify-end',
          )}
        >
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
