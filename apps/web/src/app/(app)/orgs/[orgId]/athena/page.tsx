'use client';

/**
 * The Athena chat thread — the conversational front door (one engine, many doors).
 *
 * @remarks
 * One persistent thread per org, rendered conversationally over the SAME session
 * substrate as delegated jobs: your messages right-aligned, Athena's replies left,
 * her tool work as quiet chips, and any proposed batch as the ghost-grammar
 * {@link ProposalGroupCard} — chat is a surface the one approval system lives on,
 * never a second one. Natural language is the primary medium: quick reads answer
 * instantly, and "create a plan to make sure I get more sleep" flows into the same
 * loop as any delegated job.
 */
import type { AgentSessionDetailOut, SessionActivityOut } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { Sparkles } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { ProposalGroupCard } from '@/components/agents/proposal-group-card';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { useSessionDetail } from '@/lib/use-session-detail';

/** AthenaChatPage renders the org's persistent Athena conversation. */
export default function AthenaChatPage(): JSX.Element {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const [thread, setThread] = useState<AgentSessionDetailOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await api.v1.orgs[':orgId'].sessions.chat.$get({ param: { orgId } });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not open the conversation.'));
        return;
      }
      setThread(await res.json());
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
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-4 @2xl:p-6">
      <header className="flex flex-col gap-1 pb-4">
        <h1 className="text-on-surface text-h1">Athena</h1>
        <p className="text-on-surface-variant text-body">
          Ask anything about your work, or hand her a job — she does the busywork, you keep the
          decisions.
        </p>
      </header>

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
  if (proposals.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
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
