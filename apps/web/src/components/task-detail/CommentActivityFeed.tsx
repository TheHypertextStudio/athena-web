'use client';

import type { CommentOut, SessionActivityOut } from '@docket/types';
import { ActorAvatar, type ActorKind } from '@docket/ui/components';
import { Sparkles } from '@docket/ui/icons';
import { Badge, Button, Separator } from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

/** A resolved actor descriptor for rendering an author avatar + name. */
export interface FeedActor {
  /** The actor's display name. */
  name: string;
  /** The actor kind, selecting the avatar shape/ring. */
  kind: ActorKind;
  /** Optional avatar image URL. */
  avatarUrl?: string | null;
}

/** Props for {@link CommentActivityFeed}. */
interface CommentActivityFeedProps {
  /** The task's comments, oldest first (the API returns ascending by creation). */
  comments: readonly CommentOut[];
  /** The agent session's activity stream when the task has a session, else empty. */
  activities: readonly SessionActivityOut[];
  /** Resolve an actor id to its display info (humans from members, agents from agents). */
  resolveActor: (actorId: string | null | undefined) => FeedActor;
  /** Post a new comment by body; resolves when the create round-trip completes. */
  onComment: (body: string) => Promise<void>;
  /** Whether the caller may post comments (hides the composer when false). */
  canComment: boolean;
}

/** The unified feed entry kinds, time-ordered into one stream. */
type FeedEntry =
  | { kind: 'comment'; at: number; comment: CommentOut }
  | { kind: 'activity'; at: number; activity: SessionActivityOut };

/** Human-readable label for each session-activity type. */
const ACTIVITY_LABEL: Record<SessionActivityOut['type'], string> = {
  thought: 'thought',
  action: 'proposed an action',
  response: 'responded',
  elicitation: 'asked',
  error: 'hit an error',
};

/** Map an approval status to a {@link Badge} variant + label for an action row. */
function approvalBadge(
  status: NonNullable<SessionActivityOut['approvalStatus']> | null | undefined,
): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } | null {
  switch (status) {
    case 'proposed':
      return { label: 'Awaiting approval', variant: 'secondary' };
    case 'approved':
      return { label: 'Approved', variant: 'outline' };
    case 'applied':
      return { label: 'Applied', variant: 'default' };
    case 'rejected':
      return { label: 'Rejected', variant: 'destructive' };
    default:
      return null;
  }
}

/** Read the free-text body off a non-action activity (the API stores `{ text }`). */
function activityText(body: SessionActivityOut['body']): string {
  const value = body['text'];
  return typeof value === 'string' ? value : '';
}

/** Read the `{ action: { kind, summary } }` shape off an action activity body. */
function activityAction(
  body: SessionActivityOut['body'],
): { kind: string; summary: string } | null {
  const action = body['action'];
  if (action && typeof action === 'object') {
    const record = action as Record<string, unknown>;
    const kind = typeof record['kind'] === 'string' ? record['kind'] : '';
    const summary = typeof record['summary'] === 'string' ? record['summary'] : '';
    if (summary) return { kind, summary };
  }
  return null;
}

/** Format an ISO timestamp as a compact local time-of-day + date. */
function formatTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** One human comment in the feed: author avatar, name, time, and body. */
function CommentEntry({
  comment,
  resolveActor,
}: {
  comment: CommentOut;
  resolveActor: CommentActivityFeedProps['resolveActor'];
}): JSX.Element {
  const author = resolveActor(comment.authorId);
  return (
    <li className="flex gap-3">
      <ActorAvatar kind={author.kind} name={author.name} avatarUrl={author.avatarUrl} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{author.name}</span>
          <span className="text-on-surface-variant text-xs">{formatTime(comment.createdAt)}</span>
          {comment.editedAt ? (
            <span className="text-on-surface-variant text-xs">(edited)</span>
          ) : null}
        </div>
        <p className="text-on-surface mt-0.5 text-sm whitespace-pre-wrap">{comment.body}</p>
      </div>
    </li>
  );
}

/** One agent session-activity in the feed, styled as an inline timeline event. */
function ActivityEntry({ activity }: { activity: SessionActivityOut }): JSX.Element {
  const action = activity.type === 'action' ? activityAction(activity.body) : null;
  const text = action ? action.summary : activityText(activity.body);
  const badge = activity.type === 'action' ? approvalBadge(activity.approvalStatus) : null;
  const isError = activity.type === 'error';

  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="bg-surface-container-high text-primary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg"
      >
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">Agent</span>
          <span className="text-on-surface-variant text-xs">{ACTIVITY_LABEL[activity.type]}</span>
          <span className="text-on-surface-variant text-xs">·</span>
          <span className="text-on-surface-variant text-xs">{formatTime(activity.createdAt)}</span>
          {badge ? (
            <Badge variant={badge.variant} className="ml-1">
              {badge.label}
            </Badge>
          ) : null}
        </div>
        {text ? (
          <p
            className={`mt-0.5 text-sm whitespace-pre-wrap ${
              isError ? 'text-destructive' : 'text-on-surface-variant'
            }`}
          >
            {text}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The unified comment + agent-activity feed for a task.
 *
 * @remarks
 * Merges human {@link CommentOut comments} and, when the task has an agent session, that
 * session's {@link SessionActivityOut activity} stream into one chronological timeline so
 * the agent's reasoning (thoughts, proposed actions, elicitations, responses, errors) and
 * human discussion read as a single conversation — exactly the §8.5 requirement that
 * session activity streams inline. Action rows surface their approval state as a
 * {@link Badge}. A composer at the foot posts a new comment (the author is the calling
 * actor, set server-side). Re-reads are owned by the parent screen after each post.
 */
export function CommentActivityFeed({
  comments,
  activities,
  resolveActor,
  onComment,
  canComment,
}: CommentActivityFeedProps): JSX.Element {
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  /** Interleave comments + activities into one ascending-by-time stream. */
  const entries = useMemo<readonly FeedEntry[]>(() => {
    const merged: FeedEntry[] = [
      ...comments.map(
        (comment): FeedEntry => ({
          kind: 'comment',
          at: new Date(comment.createdAt).getTime(),
          comment,
        }),
      ),
      ...activities.map(
        (activity): FeedEntry => ({
          kind: 'activity',
          at: new Date(activity.createdAt).getTime(),
          activity,
        }),
      ),
    ];
    return merged.sort((a, b) => a.at - b.at);
  }, [comments, activities]);

  async function post(): Promise<void> {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    setPosting(true);
    try {
      await onComment(trimmed);
      setBody('');
    } finally {
      setPosting(false);
    }
  }

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
      <h2 id="activity-heading" className="text-sm font-medium">
        Activity
      </h2>

      {entries.length === 0 ? (
        <p className="text-on-surface-variant text-sm">
          No activity yet. Start the conversation below.
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {entries.map((entry) =>
            entry.kind === 'comment' ? (
              <CommentEntry
                key={`c-${entry.comment.id}`}
                comment={entry.comment}
                resolveActor={resolveActor}
              />
            ) : (
              <ActivityEntry key={`a-${entry.activity.id}`} activity={entry.activity} />
            ),
          )}
        </ul>
      )}

      {canComment ? (
        <>
          <Separator />
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void post();
            }}
          >
            <label htmlFor="comment-body" className="sr-only">
              Add a comment
            </label>
            <textarea
              id="comment-body"
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void post();
                }
              }}
              rows={3}
              placeholder="Leave a comment…"
              className="border-outline-variant bg-surface-container placeholder:text-on-surface-variant focus-visible:ring-ring w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant text-xs">⌘↵ to send</span>
              <Button type="submit" size="sm" disabled={posting || body.trim().length === 0}>
                {posting ? 'Posting…' : 'Comment'}
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </section>
  );
}
