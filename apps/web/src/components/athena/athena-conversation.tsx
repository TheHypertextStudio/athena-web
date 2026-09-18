'use client';

/**
 * The Athena chat thread — the conversational front door (one engine, many doors).
 *
 * @remarks
 * One persistent thread per org, rendered conversationally over the SAME session substrate as
 * delegated jobs: your messages right-aligned, Athena's replies left, her tool work as quiet
 * chips, and any proposed batch as the ghost-grammar {@link ProposalGroupCard} — chat is a
 * surface the one approval system lives on, never a second one. Natural language is the primary
 * medium: quick reads answer instantly, and "create a plan to make sure I get more sleep" flows
 * into the same loop as any delegated job.
 *
 * Shared by every door onto the thread — the standalone `/athena` page, the ⌘J utility-rail panel
 * ({@link AthenaPanelProvider}), and (in principle) any future entry point —
 * so the conversation itself is defined once and each door only supplies its own chrome.
 */
import { EmptyState } from '@docket/ui/components';
import { ArrowUp, Cable, Sparkles } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
  surfaceToneColor,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { AgentSessionDetailOut } from '@docket/athena/agent-contract';

import { ProposalGroupCard } from '@/components/agents/proposal-group-card';
import { AthenaContextChip } from '@/components/athena/athena-context-chip';
import { AthenaJobCard } from '@/components/athena/athena-job-card';
import { ConversationSuggestions } from '@/components/athena/conversation-suggestions';
import { ElicitationQueue } from '@/components/athena/elicitation-queue';
import { PartialLoadBanner, presentFailure, QueryLoadFailure } from '@/components/feedback';
import { ThreadEntries } from '@/components/athena/thread-entries';
import { useMentionOrgId } from '@/components/mentions/use-mention-org';
import { AddMcpConnectorForm } from '@/components/settings/mcp-connectors-section';
import { fetchOrgChatThread, sendOrgChatMessage, useOrgChatThread } from '@/lib/athena/chat-defs';
import { mergeThreadEntries, type ThreadEntry } from '@/lib/athena/job-presentation';
import type {
  PersonalAthenaContext,
  PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';
import { personalAthenaTransport, type PersonalAthenaTransport } from '@/lib/athena/query-defs';
import { queryKeys } from '@/lib/query';
import { useSessionDetail } from '@/lib/use-session-detail';
import { startViewTransition } from '@/lib/view-transition';
import MentionTextarea from '@/components/mentions/mention-textarea';

/** What the thread shows before its first message. */
export interface ConversationEmptyState {
  readonly title: string;
  readonly body?: string | undefined;
}

/** The empty state a standalone door shows; a door with its own subject passes a shorter one. */
const DEFAULT_EMPTY_STATE: ConversationEmptyState = {
  title: 'Athena',
};

/** Props for {@link AthenaConversation}. */
export interface AthenaConversationProps {
  /** What to show before the first message; defaults to the standalone door's prompt. */
  emptyState?: ConversationEmptyState | undefined;
  /** The org whose persistent chat thread to render. */
  orgId: string;
  /** Extra class names for the root element (host controls height/width). */
  className?: string;
  /**
   * Text to open the composer with, from a door that collected it before this mounted.
   *
   * @remarks
   * Today's prompt is such a door: you write there, the page expands into this, and the draft has
   * to arrive with you. Seeded once on mount rather than kept in sync — after that the composer is
   * yours, and a prop that kept overwriting it would fight your typing.
   */
  initialDraft?: string;
  /**
   * A draft handed to the composer after mount: each new `version` replaces the text and focuses
   * the field, the way a door into this surface seeds it. `null` asks for nothing.
   */
  draftRequest?: { readonly text: string; readonly version: number } | null;
  /** The page to attach to the next message and to draw suggestions from. */
  context?: PersonalAthenaContext | null | undefined;
  /** Whether the next message carries `context`. Defaults to attached. */
  contextAttached?: boolean | undefined;
  /** Drop the page for the next message. */
  onDetachContext?: (() => void) | undefined;
  /** Put the page back. */
  onAttachContext?: (() => void) | undefined;
  /** Whether an empty thread offers prompts. Defaults to true. */
  suggestions?: boolean | undefined;
  /** Delegated work running alongside this thread, merged into it by {@link mergeThreadEntries}. */
  jobs?: readonly PersonalAthenaSessionSummary[] | undefined;
  /** Transport a merged job's card drives its own detail read and actions through. */
  transport?: PersonalAthenaTransport | undefined;
  /**
   * A job to keep visible above the composer regardless of the thread's own scroll position — for
   * a host (the wide view's Work ledger) whose target card is not currently mounted in this thread.
   */
  pinnedJob?: PersonalAthenaSessionSummary | null | undefined;
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
  request: { readonly text: string; readonly version: number } | null,
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

/** A no-op used when the host offers a page to attach but no attach/detach control. */
const NOOP = (): void => {
  // Intentionally inert: this door does not let the person detach or reattach the page.
  void 0;
};

/** Props for {@link ComposerContext}. */
interface ComposerContextProps {
  /** The page attached to the next message; nothing renders when this is null. */
  context: PersonalAthenaContext | null;
  /** Whether the next message carries `context`. */
  attached: boolean;
  /** Drop the page for the next message. */
  onDetach: () => void;
  /** Put the page back. */
  onAttach: () => void;
}

/** The composer's chip slot: the attached page, when there is one. */
function ComposerContext({
  context,
  attached,
  onDetach,
  onAttach,
}: ComposerContextProps): JSX.Element | null {
  if (!context) return null;
  return (
    <div className="px-1 pt-1">
      <AthenaContextChip
        context={context}
        attached={attached}
        onDetach={onDetach}
        onAttach={onAttach}
      />
    </div>
  );
}

/** Props for {@link Composer}. */
interface ComposerProps {
  /** The form element, so a caller can find its textarea and focus it. */
  composerRef: React.RefObject<HTMLFormElement | null>;
  /** The page to show above the textarea, when there is one. */
  context: PersonalAthenaContext | null;
  /** Whether the next message carries `context`. */
  contextAttached: boolean;
  /** Drop the page for the next message; falls back to a no-op when the host has none. */
  onDetachContext: (() => void) | undefined;
  /** Put the page back; falls back to a no-op when the host has none. */
  onAttachContext: (() => void) | undefined;
  /** The composer's current text. */
  draft: string;
  /** Replace the composer's text. */
  setDraft: (text: string) => void;
  /** Whether a turn is in flight; disables the field and shows "Sending". */
  sending: boolean;
  /** The workspace `@` mentions search, or undefined to leave `@` a plain character. */
  mentionOrgId: string | undefined;
  /** Send the current draft. */
  onSend: () => void;
  /** Open the "Connect a tool or app" dialog. */
  onConnect: () => void;
}

/** The message composer: the attached-page chip, the mention-aware textarea, and its controls. */
function Composer({
  composerRef,
  context,
  contextAttached,
  onDetachContext,
  onAttachContext,
  draft,
  setDraft,
  sending,
  mentionOrgId,
  onSend,
  onConnect,
}: ComposerProps): JSX.Element {
  return (
    <form
      ref={composerRef}
      aria-label="Message Athena"
      className={cn(
        surfaceToneColor('prominent'),
        'focus-within:ring-ring mt-2 flex flex-col gap-1 rounded-lg p-2 transition-shadow focus-within:ring-1',
      )}
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <ComposerContext
        context={context}
        attached={contextAttached}
        onDetach={onDetachContext ?? NOOP}
        onAttach={onAttachContext ?? NOOP}
      />
      <MentionTextarea
        aria-label="Message Athena"
        placeholder="Message Athena"
        rows={3}
        value={draft}
        disabled={sending}
        onChange={setDraft}
        {...(mentionOrgId === undefined ? {} : { orgId: mentionOrgId })}
        insertMode="context"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        className="placeholder:text-on-surface-variant text-body-medium w-full resize-none bg-transparent px-2 py-1.5 outline-none disabled:opacity-50"
      />
      <div className="flex items-center justify-between">
        {/* There is no "New chat" control, and that is deliberate: a person has one Athena
          conversation, and its topics are derived by {@link AthenaConversationBrowser} rather
          than declared by hand. Starting a second thread was the only way to file a change of
          subject, and it cost you every earlier one. */}
        <Button
          type="button"
          variant="ghost"
          iconOnly
          aria-label="Connect a tool or app"
          title="Connect a tool or app"
          onClick={onConnect}
        >
          <Cable aria-hidden="true" className="size-4" />
        </Button>
        <Button
          type="submit"
          iconOnly
          aria-label={sending ? 'Sending' : 'Send'}
          title="Send"
          disabled={sending || draft.trim().length === 0}
        >
          <ArrowUp aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </form>
  );
}

/** Props for {@link ConnectDialog}. */
interface ConnectDialogProps {
  /** The org the added connector belongs to. */
  orgId: string;
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog should open or close. */
  onOpenChange: (open: boolean) => void;
}

/** The "Connect a tool or app" dialog opened from the composer. */
function ConnectDialog({ orgId, open, onOpenChange }: ConnectDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a tool or app</DialogTitle>
          <DialogDescription>
            Add a remote MCP server so Athena can use its tools and show interactive apps in this
            conversation too.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <AddMcpConnectorForm
            orgId={orgId}
            onConnected={() => {
              onOpenChange(false);
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** Props for {@link ConversationBody}. */
interface ConversationBodyProps {
  /** The thread's own read: pending placeholder, first-read failure, or a failed refresh. */
  readonly query: UseQueryResult<AgentSessionDetailOut>;
  /** The thread's activities and jobs, merged and ordered by {@link mergeThreadEntries}. */
  readonly entries: readonly ThreadEntry[];
  /** The thread itself, once loaded — carries the id and status {@link ChatProposals} needs. */
  readonly thread: AgentSessionDetailOut | null;
  readonly orgId: string;
  readonly transport: PersonalAthenaTransport;
  readonly sendWidgetMessage: (text: string) => Promise<boolean>;
  readonly reloadWithTransition: () => Promise<void>;
  readonly empty: ConversationEmptyState;
  readonly suggestions: boolean;
  readonly context: PersonalAthenaContext | null;
  readonly onPickSuggestion: (prompt: string) => void;
}

/**
 * The thread's history: a loading skeleton, the merged entries with any pending proposal group, or
 * the empty state and its suggestions.
 */
function ConversationBody({
  query,
  entries,
  thread,
  orgId,
  transport,
  sendWidgetMessage,
  reloadWithTransition,
  empty,
  suggestions,
  context,
  onPickSuggestion,
}: ConversationBodyProps): JSX.Element {
  if (thread === null && query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-10 w-2/3 rounded-xl" />
        <Skeleton className="ml-auto h-10 w-1/2 rounded-xl" />
        <Skeleton className="h-10 w-3/5 rounded-xl" />
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
      <div className="flex flex-col gap-3">
        <EmptyState icon={Sparkles} title={empty.title} body={empty.body} frame="none" />
        {suggestions ? (
          <ConversationSuggestions context={context} onPick={onPickSuggestion} />
        ) : null}
      </div>
    </>
  );
}

/** AthenaConversation renders the org's persistent Athena conversation. */
export default function AthenaConversation({
  emptyState,
  orgId,
  className,
  initialDraft,
  draftRequest = null,
  context = null,
  contextAttached = true,
  onDetachContext,
  onAttachContext,
  suggestions = true,
  jobs = [],
  transport = personalAthenaTransport,
  pinnedJob = null,
}: AthenaConversationProps): JSX.Element {
  const mentionOrgId = useMentionOrgId(orgId);
  const [sending, setSending] = useState(false);
  const { draft, setDraft, composerRef } = useComposerDraft(initialDraft, draftRequest);
  const empty = emptyState ?? DEFAULT_EMPTY_STATE;
  const [connectOpen, setConnectOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const { commitThread, reloadWithTransition, sendWidgetMessage } = useThreadWrites(orgId);

  const query = useOrgChatThread(orgId);
  const thread = query.data ?? null;
  const entries = mergeThreadEntries(thread?.activities ?? [], jobs);

  // Called after a proposal group settles (via `ChatProposals`'s `onSettled`), so the group's
  // ghost rows — each carrying a stable `view-transition-name` — morph out in place instead of
  // the list just popping. The fetch happens first and the cache write goes inside the
  // transition, which is why this does not simply `refetch()`.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [entries.length]);

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    setDraft('');
    try {
      commitThread(await sendOrgChatMessage(orgId, text, contextAttached ? context : null));
    } catch (caught) {
      setDraft(text);
      presentFailure(caught, 'Could not send your message.');
    } finally {
      setSending(false);
    }
  }, [orgId, draft, sending, commitThread, context, contextAttached]);

  // A widget speaking as the user posts into THIS thread, exactly as if typed into the composer.
  return (
    <div className={cn('flex h-full w-full flex-col', className)}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4">
        {/* placeholder: the conversation's own history — how many turns exist, who said what, and
            how long each message is. The composer below it is interactive from the first paint. */}
        <ConversationBody
          query={query}
          entries={entries}
          thread={thread}
          orgId={orgId}
          transport={transport}
          sendWidgetMessage={sendWidgetMessage}
          reloadWithTransition={reloadWithTransition}
          empty={empty}
          suggestions={suggestions}
          context={context}
          onPickSuggestion={(prompt) => {
            setDraft(prompt);
            composerRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
          }}
        />
        {sending ? (
          <p className="text-on-surface-variant text-body-medium italic" aria-live="polite">
            Athena is working…
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      {pinnedJob ? (
        <div className="pb-2">
          <AthenaJobCard
            job={pinnedJob}
            transport={transport}
            expanded
            id={`athena-pinned-${pinnedJob.id}`}
          />
        </div>
      ) : null}

      <ElicitationQueue organizationId={orgId} className="pb-2" />

      <Composer
        composerRef={composerRef}
        context={context}
        contextAttached={contextAttached}
        onDetachContext={onDetachContext}
        onAttachContext={onAttachContext}
        draft={draft}
        setDraft={setDraft}
        sending={sending}
        mentionOrgId={mentionOrgId}
        onSend={() => {
          void send();
        }}
        onConnect={() => {
          setConnectOpen(true);
        }}
      />

      <ConnectDialog orgId={orgId} open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}

/** Props for {@link ChatProposals}. */
interface ChatProposalsProps {
  orgId: string;
  sessionId: string;
  onSettled: () => Promise<void>;
}

/** The in-thread ghost review: the thread's pending batches, decidable in place. */
function ChatProposals({ orgId, sessionId, onSettled }: ChatProposalsProps): JSX.Element | null {
  const { proposals, decideGroup, editProposal, controlPending } = useSessionDetail(
    orgId,
    sessionId,
  );
  const groupRef = useRef<HTMLDivElement | null>(null);

  // The proposal group loads via its own fetch, after the message list's initial render — the
  // page's scroll-to-latest effect (keyed on activity count) has already fired by then, so
  // without this the pending approval renders below the fold with nothing to draw the eye there.
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
