'use client';

/**
 * The discussion area — project comments plus recent agent activity.
 *
 * @remarks
 * Two stacked surfaces that together form the project's conversation:
 *
 * - **Comments** — a threaded discussion on the project subject (`subjectType=project`).
 *   Root comments render with their one-level replies indented beneath them (the API keeps
 *   threads single-level; {@link comments}). A composer posts a new root comment. Agents
 *   post as their Actor, so an agent's comment naturally appears here with the agent shape.
 * - **Recent agent activity** — a compact feed of the latest visible {@link SessionActivityOut}
 *   entries from the agent sessions working in this project, giving a glanceable trace of
 *   automated work next to the human discussion.
 *
 * Loading uses {@link Skeleton}; the empty comment state invites the first post; a failed
 * load is announced via `role="alert"`.
 */
import type { CommentOut, SessionActivityType } from '@docket/types';
import { cn } from '@docket/ui';
import { ActorAvatar } from '@docket/ui/components';
import { Button, Skeleton } from '@docket/ui/primitives';
import { Sparkles } from '@docket/ui/icons';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

import type { ActorDirectory } from './actor-directory';
import { relativeTime } from './format-time';

/** A resolved agent-activity entry for the recent-activity feed. */
export interface AgentActivityEntry {
  /** Stable activity id. */
  readonly id: string;
  /** The agent's display name. */
  readonly agentName: string;
  /** The activity type (thought/action/response/elicitation/error). */
  readonly type: SessionActivityType;
  /** A short human summary of the activity. */
  readonly summary: string;
  /** ISO creation time. */
  readonly createdAt: string;
}

/** Verb copy for each activity type, used in the feed line. */
const ACTIVITY_VERB: Record<SessionActivityType, string> = {
  thought: 'considered',
  action: 'proposed',
  response: 'replied',
  elicitation: 'asked',
  error: 'hit an error',
};

/** Props for {@link Discussion}. */
export interface DiscussionProps {
  /** The project's comments, oldest-first (as returned by the API). */
  comments: readonly CommentOut[];
  /** Whether the comments are still loading. */
  loading: boolean;
  /** A load error to announce, if any. */
  error: string | null;
  /** Resolve an author id to its display name + kind. */
  resolveActor: ActorDirectory;
  /** Recent agent activity from sessions working in this project, newest-first. */
  agentActivity: readonly AgentActivityEntry[];
  /** Whether a comment post is in flight. */
  posting: boolean;
  /** A post error to surface, if any. */
  postError: string | null;
  /** Post a new root comment. */
  onPost: (body: string) => void;
}

/**
 * The discussion area body.
 *
 * @param props - The {@link DiscussionProps}.
 * @returns the rendered area.
 */
export function Discussion({
  comments,
  loading,
  error,
  resolveActor,
  agentActivity,
  posting,
  postError,
  onPost,
}: DiscussionProps): JSX.Element {
  const [body, setBody] = useState('');

  /** Roots with their single-level replies attached, preserving post order. */
  const threads = useMemo(() => {
    const roots = comments.filter((c) => !c.parentCommentId);
    const repliesByParent = new Map<string, CommentOut[]>();
    for (const c of comments) {
      if (c.parentCommentId) {
        const list = repliesByParent.get(c.parentCommentId) ?? [];
        list.push(c);
        repliesByParent.set(c.parentCommentId, list);
      }
    }
    return roots.map((root) => ({ root, replies: repliesByParent.get(root.id) ?? [] }));
  }, [comments]);

  function submit(event: React.SyntheticEvent): void {
    event.preventDefault();
    if (body.trim().length === 0) return;
    onPost(body.trim());
    setBody('');
  }

  return (
    <section aria-label="Discussion" className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h2 className="text-on-surface text-sm font-semibold">Comments</h2>

        {loading ? (
          <div className="flex flex-col gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <Skeleton className="h-12 flex-1 rounded-lg" />
              </div>
            ))}
          </div>
        ) : error ? (
          <p
            role="alert"
            className="border-outline-variant text-destructive rounded-lg border p-4 text-sm"
          >
            {error}
          </p>
        ) : threads.length === 0 ? (
          <div className="border-outline-variant text-on-surface-variant rounded-xl border border-dashed p-6 text-center text-sm">
            No comments yet. Start the conversation below.
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {threads.map(({ root, replies }) => (
              <li key={root.id} className="flex flex-col gap-3">
                <CommentBubble comment={root} resolveActor={resolveActor} />
                {replies.length > 0 ? (
                  <ol className="border-outline-variant ml-4 flex flex-col gap-3 border-l pl-4">
                    {replies.map((reply) => (
                      <li key={reply.id}>
                        <CommentBubble comment={reply} resolveActor={resolveActor} />
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
        )}

        <form onSubmit={submit} className="flex flex-col gap-2">
          <textarea
            aria-label="Write a comment"
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
            rows={2}
            placeholder="Write a comment…"
            className="border-outline-variant bg-surface-container placeholder:text-on-surface-variant focus-visible:ring-ring min-h-16 w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1"
          />
          <div className="flex items-center justify-end gap-2">
            {postError ? (
              <p role="alert" className="text-destructive mr-auto text-sm">
                {postError}
              </p>
            ) : null}
            <Button type="submit" size="sm" disabled={posting || body.trim().length === 0}>
              {posting ? 'Posting…' : 'Comment'}
            </Button>
          </div>
        </form>
      </div>

      {agentActivity.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="text-primary size-4" />
            <h2 className="text-on-surface text-sm font-semibold">Recent agent activity</h2>
          </div>
          <ul className="flex flex-col gap-2">
            {agentActivity.map((entry) => (
              <li
                key={entry.id}
                className="border-outline-variant bg-surface-container-low flex items-start gap-3 rounded-lg border px-3 py-2"
              >
                <ActorAvatar kind="agent" name={entry.agentName} size={24} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-on-surface text-sm">
                    <span className="font-medium">{entry.agentName}</span>{' '}
                    <span className="text-on-surface-variant">{ACTIVITY_VERB[entry.type]}</span>
                  </span>
                  <span className="text-on-surface-variant truncate text-xs">{entry.summary}</span>
                </div>
                <span className="text-on-surface-variant shrink-0 text-xs">
                  {relativeTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** A single comment bubble with author, timestamp, and body. */
function CommentBubble({
  comment,
  resolveActor,
}: {
  comment: CommentOut;
  resolveActor: ActorDirectory;
}): JSX.Element {
  const author = resolveActor(comment.authorId);
  return (
    <div className="flex gap-3">
      <ActorAvatar kind={author.kind} name={author.name} size={28} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-on-surface text-sm font-medium">{author.name}</span>
          <span className="text-on-surface-variant text-xs">{relativeTime(comment.createdAt)}</span>
          {comment.editedAt ? (
            <span className="text-on-surface-variant text-xs italic">(edited)</span>
          ) : null}
        </div>
        <div
          className={cn(
            'bg-surface-container text-on-surface rounded-lg px-3 py-2 text-sm leading-relaxed',
          )}
        >
          <p className="whitespace-pre-wrap">{comment.body}</p>
        </div>
      </div>
    </div>
  );
}
