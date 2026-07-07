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
 * Shared by every door onto the thread — the standalone `/orgs/:orgId/athena` page, the ⌘J
 * slide-over panel ({@link AthenaPanelProvider}), and (in principle) any future entry point —
 * so the conversation itself is defined once and each door only supplies its own chrome.
 */
import type { AgentSessionDetailOut, SessionActivityOut } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { Cable, Plus, Sparkles } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { ProposalGroupCard } from '@/components/agents/proposal-group-card';
import { AddMcpConnectorForm } from '@/components/settings/mcp-connectors-section';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { useSessionDetail } from '@/lib/use-session-detail';
import { startViewTransition } from '@/lib/view-transition';

/** Props for {@link AthenaConversation}. */
export interface AthenaConversationProps {
  /** The org whose persistent chat thread to render. */
  orgId: string;
  /** Extra class names for the root element (host controls height/width). */
  className?: string;
}

/** AthenaConversation renders the org's persistent Athena conversation. */
export default function AthenaConversation({
  orgId,
  className,
}: AthenaConversationProps): JSX.Element {
  const [thread, setThread] = useState<AgentSessionDetailOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await api.v1.orgs[':orgId'].sessions.chat.$get({ param: { orgId } });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not open the conversation.'));
        return;
      }
      const data = await res.json();
      // Called after a proposal group settles (via `ChatProposals`'s `onSettled`), so the group's
      // ghost rows — each carrying a stable `view-transition-name` — morph out in place instead of
      // the list just popping.
      startViewTransition(() => {
        setThread(data);
      });
    } catch (caught) {
      setError(readError(caught, 'Something went wrong opening the conversation.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread?.activities.length]);

  const newChat = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await api.v1.orgs[':orgId'].sessions.chat.new.$post({ param: { orgId } });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not start a new chat.'));
        return;
      }
      const data = await res.json();
      // The prior conversation isn't deleted — it's just no longer "current" — so clear the
      // visible thread the same way an approval clears its ghosts: as a transition, not a jump.
      startViewTransition(() => {
        setThread(data);
      });
    } catch (caught) {
      setError(readError(caught, 'Something went wrong starting a new chat.'));
    }
  }, [orgId]);

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setError(null);
    setSending(true);
    setDraft('');
    try {
      const res = await api.v1.orgs[':orgId'].sessions.chat.messages.$post({
        param: { orgId },
        json: { body: text },
      });
      if (!res.ok) {
        setDraft(text);
        setError(await readProblem(res, 'Athena could not answer right now.'));
        return;
      }
      setThread(await res.json());
    } catch (caught) {
      setDraft(text);
      setError(readError(caught, 'Something went wrong reaching Athena.'));
    } finally {
      setSending(false);
    }
  }, [orgId, draft, sending]);

  return (
    <div className={cn('flex h-full w-full flex-col', className)}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4">
        {loading ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-10 w-2/3 rounded-xl" />
            <Skeleton className="ml-auto h-10 w-1/2 rounded-xl" />
            <Skeleton className="h-10 w-3/5 rounded-xl" />
          </div>
        ) : thread && thread.activities.length > 0 ? (
          <>
            {thread.activities.map((activity) => (
              <ChatEntry key={activity.id} activity={activity} />
            ))}
            {thread.status === 'awaiting_approval' ? (
              <ChatProposals orgId={orgId} sessionId={thread.id} onSettled={load} />
            ) : null}
          </>
        ) : (
          <EmptyState
            icon={Sparkles}
            title="This is your line to Athena"
            body='Try "What should I focus on today?" or "Create a plan to make sure I get more sleep."'
            className="border-none bg-transparent"
          />
        )}
        {sending ? (
          <p className="text-on-surface-variant text-body italic" aria-live="polite">
            Athena is working…
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-body pb-2">
          {error}
        </p>
      ) : null}

      <form
        className="flex items-end gap-2 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Message Athena"
          placeholder="Ask Athena anything…"
          rows={2}
          value={draft}
          disabled={sending}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          className={cn(
            'border-outline-variant bg-surface-container placeholder:text-on-surface-variant text-body w-full resize-none rounded-xl border px-4 py-3',
            'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-1 disabled:opacity-50',
          )}
        />
        <Button type="submit" disabled={sending || draft.trim().length === 0}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </form>

      <div className="flex items-center justify-end gap-1 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-on-surface-variant gap-1.5"
          disabled={!thread || thread.activities.length === 0}
          onClick={() => {
            void newChat();
          }}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          New chat
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-on-surface-variant gap-1.5"
          onClick={() => {
            setConnectOpen(true);
          }}
        >
          <Cable aria-hidden="true" className="size-3.5" />
          Connect a tool
        </Button>
      </div>

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a tool</DialogTitle>
            <DialogDescription>
              Add a remote MCP server so Athena can use its tools in this conversation too.
            </DialogDescription>
          </DialogHeader>
          <AddMcpConnectorForm
            orgId={orgId}
            onConnected={() => {
              setConnectOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Props for {@link ChatEntry}. */
interface ChatEntryProps {
  activity: SessionActivityOut;
}

/** One conversational beat: user bubble, Athena text, quiet work chip, or question. */
function ChatEntry({ activity }: ChatEntryProps): JSX.Element | null {
  const text = typeof activity.body['text'] === 'string' ? activity.body['text'] : '';
  const fromUser = activity.body['author'] === 'user';

  if (activity.type === 'response' && fromUser) {
    return (
      <div className="bg-primary text-on-primary text-body ml-auto max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 whitespace-pre-wrap">
        {text}
      </div>
    );
  }
  if (activity.type === 'response' || activity.type === 'elicitation') {
    return (
      <div className="bg-surface-container text-on-surface text-body mr-auto max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 whitespace-pre-wrap">
        {text}
      </div>
    );
  }
  if (activity.type === 'error') {
    return (
      <p role="alert" className="text-destructive text-body mr-auto">
        {text || 'Athena hit an error.'}
      </p>
    );
  }
  if (activity.type === 'action') {
    const action = activity.body['action'];
    const summary =
      action && typeof action === 'object' && 'summary' in action
        ? String((action as Record<string, unknown>)['summary'])
        : 'worked';
    return (
      <span className="border-outline-variant bg-surface-container text-on-surface-variant mr-auto inline-flex max-w-[85%] items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs">
        <span className="truncate">{summary}</span>
      </span>
    );
  }
  // Thoughts stay out of the conversation — the work-log session view carries them.
  return null;
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
