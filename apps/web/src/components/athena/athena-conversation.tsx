'use client';

/**
 * The Athena chat thread — the conversational front door (one engine, many doors).
 *
 * @remarks
 * One persistent thread per org, rendered conversationally over the SAME session substrate as
 * delegated jobs: your messages right-aligned, Athena's replies left, her tool work as quiet
 * lines, delegated work as flat entries, questions at the time they were asked, and any proposed
 * batch as the ghost-grammar {@link ProposalGroupCard} — chat is a surface the one approval system
 * lives on, never a second one.
 *
 * Two regions only: the scrolling thread ({@link ConversationThread}) and the composer
 * ({@link Composer}). Shared by every door onto the thread — the ⌘J rail panel, the `/athena`
 * page, and Today's expanded session — so the conversation is defined once and each door supplies
 * only its own chrome.
 */
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { AgentSessionDetailOut } from '@docket/athena/agent-contract';
import { cn } from '@docket/ui/lib/utils';

import { AthenaContextChip } from '@/components/athena/athena-context-chip';
import { Composer, ConnectDialog } from '@/components/athena/conversation-composer';
import { ConversationThread } from '@/components/athena/conversation-thread';
import { type ThreadQuestions, useThreadQuestions } from '@/components/athena/elicitation-queue';
import { presentFailure } from '@/components/feedback';
import { useMentionOrgId } from '@/components/mentions/use-mention-org';
import {
  AcceptedChatRefreshError,
  fetchOrgChatThread,
  sendOrgChatMessage,
  useOrgChatThread,
} from '@/lib/athena/chat-defs';
import { dismissHeadsUp, type HeadsUp, headsUpsFor } from '@/lib/athena/heads-ups';
import {
  jobsNeedingYou,
  mergeThreadEntries,
  type ThreadEntry,
} from '@/lib/athena/job-presentation';
import type {
  PersonalAthenaContext,
  PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';
import { personalAthenaTransport, type PersonalAthenaTransport } from '@/lib/athena/query-defs';
import { queryKeys } from '@/lib/query';
import { failurePresentation, type FailurePresentation } from '@/lib/failure-presentation';
import { startViewTransition } from '@/lib/view-transition';

/** What the thread shows before its first message, from a door with a subject of its own. */
export interface ConversationEmptyState {
  readonly title: string;
  readonly body?: string | undefined;
}

/** A draft handed to the composer after mount. */
export interface ComposerDraftRequest {
  readonly text: string;
  readonly version: number;
}

/** Props for {@link AthenaConversation}. */
export interface AthenaConversationProps {
  /** The full-page surface uses a roomier conversation layout than the rail. */
  layout?: 'page' | 'panel';
  /** A one-line label for an empty thread; the default empty thread is its suggestions alone. */
  emptyState?: ConversationEmptyState | undefined;
  /** The org whose persistent chat thread to render. */
  orgId: string;
  /** Extra class names for the root element (host controls height/width). */
  className?: string;
  /**
   * Text to open the composer with, from a door that collected it before this mounted. Seeded once
   * on mount rather than kept in sync — after that the composer is yours.
   */
  initialDraft?: string;
  /**
   * A draft handed to the composer after mount: each new `version` replaces the text and focuses
   * the field, the way a door into this surface seeds it. `null` asks for nothing.
   */
  draftRequest?: ComposerDraftRequest | null;
  /** The page to attach to the next message and to draw suggestions from. */
  context?: PersonalAthenaContext | null | undefined;
  /** Whether the next message carries `context`. Defaults to attached. */
  contextAttached?: boolean | undefined;
  /** Drop the page for the next message. */
  onDetachContext?: (() => void) | undefined;
  /** Put the page back. */
  onAttachContext?: (() => void) | undefined;
  /**
   * Show the page chip inside the composer. Off by default: the rail panel holds it in its header;
   * a door with no header of its own turns this on.
   */
  composerChip?: boolean | undefined;
  /** A Talk control for the composer's trailing row, from a door with no header to hold it. */
  talk?: ReactNode;
  /** Whether an empty thread offers prompts. Defaults to true. */
  suggestions?: boolean | undefined;
  /** Delegated work that belongs in this thread, merged into it by {@link mergeThreadEntries}. */
  jobs?: readonly PersonalAthenaSessionSummary[] | undefined;
  /** Transport a merged job's entry drives its own detail read and actions through. */
  transport?: PersonalAthenaTransport | undefined;
  /**
   * Whether questions, and the presence heartbeat that makes them live, belong to this instance;
   * exactly one mounted conversation should own them.
   */
  questions?: boolean | undefined;
  /** A job id the host wants this thread scrolled to, e.g. from a ledger row elsewhere. */
  scrollToJobId?: string | null | undefined;
  /** Reports that `scrollToJobId` was found and scrolled to, so the host can clear its request. */
  onScrolledToJob?: ((jobId: string) => void) | undefined;
}

/** The composer's draft, its form, and how a requested draft lands in it. */
interface ComposerDraft {
  readonly draft: string;
  readonly setDraft: (text: string) => void;
  readonly composerRef: React.RefObject<HTMLFormElement | null>;
}

/**
 * The composer's text. Seeded once from `initialDraft`; a requested draft replaces it and takes
 * focus, once per version.
 */
function useComposerDraft(
  initialDraft: string | undefined,
  request: ComposerDraftRequest | null,
): ComposerDraft {
  const [draft, setDraft] = useState(initialDraft ?? '');
  const composerRef = useRef<HTMLFormElement | null>(null);
  const version = request?.version ?? null;
  const text = request?.text ?? '';
  useEffect(() => {
    if (version === null) return;
    setDraft(text);
    composerRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
  }, [version, text]);
  return { draft, setDraft, composerRef };
}

/** The thread's writes: commit a thread, reload it with a transition, send from a widget. */
interface ThreadWrites {
  readonly commitThread: (data: AgentSessionDetailOut) => void;
  readonly reloadWithTransition: () => Promise<void>;
  readonly sendWidgetMessage: (text: string) => Promise<boolean>;
}

/** The writes every part of the conversation reaches for. */
function useThreadWrites(orgId: string): ThreadWrites {
  const queryClient = useQueryClient();
  const commitThread = useCallback(
    (data: AgentSessionDetailOut): void => {
      queryClient.setQueryData(queryKeys.chatThread(orgId), data);
    },
    [queryClient, orgId],
  );

  // Called after a proposal group settles, so the group's ghost rows — each carrying a stable
  // `view-transition-name` — morph out in place instead of the list just popping. The fetch
  // happens first and the cache write goes inside the transition.
  const reloadWithTransition = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchOrgChatThread(orgId);
      startViewTransition(() => {
        commitThread(data);
      });
    } catch (caught) {
      presentFailure(caught, 'Could not refresh the conversation.');
    }
  }, [orgId, commitThread]);

  // A widget speaking as the user posts into THIS thread, exactly as if typed into the composer.
  const sendWidgetMessage = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        commitThread(await sendOrgChatMessage(orgId, text));
        return true;
      } catch {
        return false;
      }
    },
    [orgId, commitThread],
  );

  return { commitThread, reloadWithTransition, sendWidgetMessage };
}

/** What sending a message needs from the conversation around it. */
interface SendInput {
  readonly orgId: string;
  readonly composer: ComposerDraft;
  readonly context: PersonalAthenaContext | null;
  readonly contextAttached: boolean;
  readonly onAttachContext: (() => void) | undefined;
  readonly commitThread: (data: AgentSessionDetailOut) => void;
  readonly thread: AgentSessionDetailOut | null;
}

/** A just-submitted message, before the server's activity has appeared in the thread. */
export interface PendingTurn {
  readonly text: string;
  readonly knownActivityIds: ReadonlySet<string>;
}

/** The send state: local progress and any failure remain visible in the conversation. */
interface SendState {
  readonly sending: boolean;
  readonly pendingTurn: PendingTurn | null;
  readonly failure: FailurePresentation | null;
  readonly refreshDelayed: boolean;
  readonly send: () => void;
}

/** Send the composer's draft, restoring it and reporting the failure when the send fails. */
function useSend({
  orgId,
  composer,
  context,
  contextAttached,
  onAttachContext,
  commitThread,
  thread,
}: SendInput): SendState {
  const [sending, setSending] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const [failure, setFailure] = useState<FailurePresentation | null>(null);
  const [refreshDelayed, setRefreshDelayed] = useState(false);
  const queryClient = useQueryClient();
  const { draft, setDraft } = composer;

  useEffect(() => {
    if (!refreshDelayed || !pendingTurn) return;
    const recorded = thread?.activities.some(
      (activity) =>
        !pendingTurn.knownActivityIds.has(activity.id) &&
        activity.type === 'response' &&
        activity.body['author'] === 'user' &&
        activity.body['text'] === pendingTurn.text,
    );
    if (recorded) {
      setPendingTurn(null);
      setRefreshDelayed(false);
    }
  }, [refreshDelayed, pendingTurn, thread]);

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    setFailure(null);
    setRefreshDelayed(false);
    setPendingTurn({ text, knownActivityIds: new Set(thread?.activities.map((a) => a.id) ?? []) });
    setDraft('');
    try {
      commitThread(await sendOrgChatMessage(orgId, text, contextAttached ? context : null));
      setPendingTurn(null);
      // A detach applies to exactly one message: once it has gone out, the next one carries the
      // page again unless the person detaches it again.
      onAttachContext?.();
    } catch (caught) {
      if (caught instanceof AcceptedChatRefreshError) {
        setRefreshDelayed(true);
        onAttachContext?.();
      } else {
        setDraft(text);
        setFailure(failurePresentation(caught, 'Could not send your message.'));
        setPendingTurn(null);
      }
      // The server can save the prompt before inference fails. Refresh the transcript so that
      // the thread shows whichever part of this turn was durably recorded.
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatThread(orgId) });
    } finally {
      setSending(false);
    }
  }, [
    orgId,
    draft,
    sending,
    setDraft,
    commitThread,
    context,
    contextAttached,
    onAttachContext,
    thread,
    queryClient,
  ]);

  return {
    sending,
    pendingTurn,
    failure,
    refreshDelayed,
    send: () => {
      void send();
    },
  };
}

/** The heads-ups the thread's jobs qualify for, the one closed, and how to close one. */
interface HeadsUpState {
  readonly headsUps: readonly HeadsUp[];
  readonly closedId: string | null;
  readonly dismiss: (id: string) => void;
}

/** The heads-up the thread's jobs qualify for, and dismissing it. */
function useHeadsUps(jobs: readonly PersonalAthenaSessionSummary[]): HeadsUpState {
  // Captured once per mount: a heads-up's "has been waiting since" reading should hold steady for
  // the life of this panel. `jobs` is re-read on every poll tick the host already runs, which is
  // what lets a heads-up appear or clear without this component polling anything of its own.
  const [now] = useState(() => new Date());
  const headsUps = useMemo(() => headsUpsFor(jobs, now), [jobs, now]);
  const [closedId, setClosedId] = useState<string | null>(null);
  const dismiss = useCallback((id: string): void => {
    dismissHeadsUp(id);
    setClosedId(id);
  }, []);
  return { headsUps, closedId, dismiss };
}

/** The props a conversation reads, with every default applied. */
interface ConversationSettings {
  readonly context: PersonalAthenaContext | null;
  readonly contextAttached: boolean;
  readonly jobs: readonly PersonalAthenaSessionSummary[];
  readonly transport: PersonalAthenaTransport;
  readonly questions: boolean;
  readonly suggestions: boolean;
  readonly draftRequest: ComposerDraftRequest | null;
  readonly scrollToJobId: string | null;
}

/** Apply every default in one place, so the component itself stays a composition. */
function conversationSettings(props: AthenaConversationProps): ConversationSettings {
  return {
    context: props.context ?? null,
    contextAttached: props.contextAttached ?? true,
    jobs: props.jobs ?? [],
    transport: props.transport ?? personalAthenaTransport,
    questions: props.questions ?? true,
    suggestions: props.suggestions ?? true,
    draftRequest: props.draftRequest ?? null,
    scrollToJobId: props.scrollToJobId ?? null,
  };
}

/** The page chip for a door that keeps it in the composer, or nothing. */
function composerChipFor(
  props: AthenaConversationProps,
  settings: ConversationSettings,
): ReactNode {
  if (!props.composerChip || !settings.context) return null;
  return (
    <AthenaContextChip
      context={settings.context}
      attached={settings.contextAttached}
      onDetach={props.onDetachContext ?? NOOP}
      onAttach={props.onAttachContext ?? NOOP}
    />
  );
}

/** The thread's own read, merged with its work and questions. */
interface ThreadRead {
  readonly query: UseQueryResult<AgentSessionDetailOut>;
  readonly thread: AgentSessionDetailOut | null;
  readonly entries: readonly ThreadEntry[];
}

/** Read the conversation and merge the jobs and questions that belong in it. */
function useThreadRead(
  orgId: string,
  jobs: readonly PersonalAthenaSessionSummary[],
  questions: ThreadQuestions,
): ThreadRead {
  const query = useOrgChatThread(orgId);
  return {
    query,
    thread: query.data ?? null,
    entries: mergeThreadEntries(query.data?.activities ?? [], jobs, questions.questions),
  };
}

/** AthenaConversation renders the org's persistent Athena conversation. */
export default function AthenaConversation(props: AthenaConversationProps): JSX.Element {
  const { orgId } = props;
  const settings = conversationSettings(props);
  const { context, contextAttached, jobs } = settings;
  const mentionOrgId = useMentionOrgId(orgId);
  const composer = useComposerDraft(props.initialDraft, settings.draftRequest);
  const [connectOpen, setConnectOpen] = useState(false);
  const { commitThread, reloadWithTransition, sendWidgetMessage } = useThreadWrites(orgId);
  const questions = useThreadQuestions(orgId, settings.questions);
  const headsUps = useHeadsUps(jobs);
  const read = useThreadRead(orgId, jobs, questions);
  const sendState = useSend({
    orgId,
    composer,
    context,
    contextAttached,
    onAttachContext: props.onAttachContext,
    commitThread,
    thread: read.thread,
  });

  return (
    <div className={cn('flex h-full w-full flex-col', props.className)}>
      <ConversationThread
        query={read.query}
        entries={read.entries}
        thread={read.thread}
        layout={props.layout ?? 'panel'}
        pendingTurn={sendState.pendingTurn}
        sendFailure={sendState.failure}
        refreshDelayed={sendState.refreshDelayed}
        orgId={orgId}
        transport={settings.transport}
        sendWidgetMessage={sendWidgetMessage}
        reloadWithTransition={reloadWithTransition}
        emptyLabel={props.emptyState?.title}
        suggestions={settings.suggestions}
        context={context}
        onPickSuggestion={(prompt) => {
          composer.setDraft(prompt);
          composer.composerRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
        }}
        headsUps={headsUps.headsUps}
        closedHeadsUpId={headsUps.closedId}
        onDismissHeadsUp={headsUps.dismiss}
        waitingJobId={jobsNeedingYou(jobs).at(0)?.id ?? null}
        landingQuestionId={questions.landingId}
        scrollToJobId={settings.scrollToJobId}
        onScrolledToJob={props.onScrolledToJob}
      />
      <Composer
        composerRef={composer.composerRef}
        chip={composerChipFor(props, settings)}
        talk={props.talk}
        draft={composer.draft}
        setDraft={composer.setDraft}
        sending={sendState.sending}
        layout={props.layout ?? 'panel'}
        mentionOrgId={mentionOrgId}
        onSend={sendState.send}
        onConnect={() => {
          setConnectOpen(true);
        }}
      />
      <ConnectDialog orgId={orgId} open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}

/** A no-op used when the host offers a page to attach but no attach/detach control. */
function NOOP(): void {
  // Intentionally inert: this door does not let the person detach or reattach the page.
}
