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
import { parseMcpAppPresentation } from '@docket/integrations/mcp-apps-contract';
import { type SessionActivityOut } from '@docket/athena/agent-contract';
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
  Surface,
  surfaceToneColor,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import type { AgentSessionDetailOut } from '@docket/athena/agent-contract';
import { PLAN_TOOL_NAMES } from '@docket/work/plan-draft-contract';

import { ProposalGroupCard } from '@/components/agents/proposal-group-card';
import { McpAppPresentationCard } from '@/components/athena/mcp-app-presentation-card';
import PlanStartCard, { parsePlanStart } from '@/components/plan-canvas/plan-start-card';
import { useMentionOrgId } from '@/components/mentions/use-mention-org';
import { AddMcpConnectorForm } from '@/components/settings/mcp-connectors-section';
import { fetchOrgChatThread, sendOrgChatMessage, useOrgChatThread } from '@/lib/athena/chat-defs';
import { userErrorMessage } from '@/lib/problem';
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
  title: 'This is your line to Athena',
  body: 'Try "What should I focus on today?" or "Create a plan to make sure I get more sleep."',
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
function useThreadWrites(orgId: string, onError: (message: string) => void): ThreadWrites {
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
      onError(userErrorMessage(caught, 'Something went wrong opening the conversation.'));
    }
  }, [orgId, commitThread, onError]);

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

/** AthenaConversation renders the org's persistent Athena conversation. */
export default function AthenaConversation({
  emptyState,
  orgId,
  className,
  initialDraft,
  draftRequest = null,
}: AthenaConversationProps): JSX.Element {
  const mentionOrgId = useMentionOrgId(orgId);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const { draft, setDraft, composerRef } = useComposerDraft(initialDraft, draftRequest);
  const empty = emptyState ?? DEFAULT_EMPTY_STATE;
  const [connectOpen, setConnectOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const { commitThread, reloadWithTransition, sendWidgetMessage } = useThreadWrites(
    orgId,
    setSendError,
  );

  const query = useOrgChatThread(orgId);
  const thread = query.data ?? null;
  const loading = query.isPending;
  const error =
    sendError ??
    (query.isError ? userErrorMessage(query.error, 'Could not open the conversation.') : null);

  // Called after a proposal group settles (via `ChatProposals`'s `onSettled`), so the group's
  // ghost rows — each carrying a stable `view-transition-name` — morph out in place instead of
  // the list just popping. The fetch happens first and the cache write goes inside the
  // transition, which is why this does not simply `refetch()`.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread?.activities.length]);

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSendError(null);
    setSending(true);
    setDraft('');
    try {
      commitThread(await sendOrgChatMessage(orgId, text));
    } catch (caught) {
      setDraft(text);
      setSendError(userErrorMessage(caught, 'Something went wrong reaching Athena.'));
    } finally {
      setSending(false);
    }
  }, [orgId, draft, sending, commitThread]);

  // A widget speaking as the user posts into THIS thread, exactly as if typed into the composer.
  return (
    <div className={cn('flex h-full w-full flex-col', className)}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4">
        {/* placeholder: the conversation's own history — how many turns exist, who said what, and
            how long each message is. The composer below it is interactive from the first paint. */}
        {loading ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-10 w-2/3 rounded-xl" />
            <Skeleton className="ml-auto h-10 w-1/2 rounded-xl" />
            <Skeleton className="h-10 w-3/5 rounded-xl" />
          </div>
        ) : thread && thread.activities.length > 0 ? (
          <>
            {thread.activities.map((activity) => (
              <ChatEntry
                key={activity.id}
                activity={activity}
                onWidgetMessage={sendWidgetMessage}
              />
            ))}
            {thread.status === 'awaiting_approval' ? (
              <ChatProposals orgId={orgId} sessionId={thread.id} onSettled={reloadWithTransition} />
            ) : null}
          </>
        ) : (
          <EmptyState icon={Sparkles} title={empty.title} body={empty.body} frame="none" />
        )}
        {sending ? (
          <p className="text-on-surface-variant text-body-medium italic" aria-live="polite">
            Athena is working…
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <p role="alert" className="text-error text-body-medium pb-2">
          {error}
        </p>
      ) : null}

      <form
        ref={composerRef}
        className={cn(
          surfaceToneColor('prominent'),
          'focus-within:ring-ring mt-2 flex flex-col gap-1 rounded-lg p-2 transition-shadow focus-within:ring-1',
        )}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <MentionTextarea
          aria-label="Message Athena"
          placeholder="Ask Athena anything…"
          rows={3}
          value={draft}
          disabled={sending}
          onChange={setDraft}
          {...(mentionOrgId === undefined ? {} : { orgId: mentionOrgId })}
          insertMode="context"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
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
            onClick={() => {
              setConnectOpen(true);
            }}
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

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
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
                setConnectOpen(false);
              }}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Props for {@link ChatEntry}. */
interface ChatEntryProps {
  activity: SessionActivityOut;
  /** Posts a widget-composed `ui/message` into this thread, as the user. */
  onWidgetMessage: (text: string) => Promise<boolean>;
}

/** Read one nested object off an untrusted activity body. */
function bodyRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/**
 * The plan a `plan_start` action opened, when the action was one and succeeded.
 *
 * @remarks
 * Athena's offer to plan on the canvas is the tool result itself: a durable card that links to the
 * plan route, so opening it is the yes and a reload finds it where it was.
 */
function startedPlanFrom(
  action: Readonly<Record<string, unknown>> | null,
  result: Readonly<Record<string, unknown>> | null,
): ReturnType<typeof parsePlanStart> {
  if (action?.['kind'] !== PLAN_TOOL_NAMES.start || result?.['isError'] === true) return null;
  return parsePlanStart(result?.['content']);
}

/** One conversational beat: user bubble, Athena text, quiet work chip, or question. */
function ChatEntry({ activity, onWidgetMessage }: ChatEntryProps): JSX.Element | null {
  const text = typeof activity.body['text'] === 'string' ? activity.body['text'] : '';
  const fromUser = activity.body['author'] === 'user';

  if (activity.type === 'response' && fromUser) {
    return (
      <div className="bg-primary text-on-primary text-body-medium ml-auto max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 whitespace-pre-wrap">
        {text}
      </div>
    );
  }
  if (activity.type === 'response' || activity.type === 'elicitation') {
    return (
      <Surface
        tone="canvas"
        shape="medium"
        className="text-body-medium mr-auto max-w-[85%] rounded-bl-sm px-4 py-2.5 whitespace-pre-wrap"
      >
        {text}
      </Surface>
    );
  }
  if (activity.type === 'error') {
    return (
      <p role="alert" className="text-error text-body-medium mr-auto">
        {text || 'Athena hit an error.'}
      </p>
    );
  }
  if (activity.type === 'action') {
    return <ActionEntry activity={activity} onWidgetMessage={onWidgetMessage} />;
  }
  // Thoughts stay out of the conversation — the work-log session view carries them.
  return null;
}

/** The quiet work chip for one tool call, with whatever durable card the call produced. */
function ActionEntry({ activity, onWidgetMessage }: ChatEntryProps): JSX.Element {
  const action = bodyRecord(activity.body['action']);
  const summary = action && typeof action['summary'] === 'string' ? action['summary'] : 'worked';
  // The chip stays the quiet record of what Athena did; when the tool captured an interactive
  // MCP app card, it renders full-width beneath the chip — the same durable presentation the
  // workbench shows, revalidated here because the body is an untrusted bag of JSON.
  const result = action ? bodyRecord(action['result']) : null;
  const presentation = parseMcpAppPresentation(result?.['presentation']);
  const presentationUnavailable =
    result?.['presentationUnavailable'] === true ||
    (result?.['presentation'] !== undefined && !presentation);
  const startedPlan = startedPlanFrom(action, result);
  return (
    <div className="flex w-full flex-col gap-2">
      <span
        className={cn(
          surfaceToneColor('canvas'),
          'border-outline-variant text-on-surface-variant mr-auto inline-flex max-w-[85%] items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs',
        )}
      >
        <span className="truncate">{summary}</span>
      </span>
      {startedPlan ? <PlanStartCard plan={startedPlan} /> : null}
      {presentation ? (
        <McpAppPresentationCard
          presentation={presentation}
          activityId={activity.id}
          onMessage={onWidgetMessage}
        />
      ) : presentationUnavailable ? (
        <p className="text-on-surface-variant text-body-small" data-testid="mcp-app-view-failure">
          Interactive view unavailable.
        </p>
      ) : null}
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
