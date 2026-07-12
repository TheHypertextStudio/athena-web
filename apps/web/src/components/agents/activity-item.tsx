'use client';

/**
 * One entry in a session's plain-English activity stream (the LEFT column of the Session
 * view, mvp-plan §8.6).
 *
 * @remarks
 * Renders a single {@link SessionActivityOut} with a type-specific glyph + tone so the stream
 * reads like a transcript of the agent thinking and working aloud:
 *
 * - `thought` 💭 — the agent reasoning; quiet, muted.
 * - `response` 💬 — the agent (or a human reply) speaking; foreground text.
 * - `action` — a concrete change. When `approvalStatus === 'proposed'` it renders the
 *   approval *gate* ([Approve ▸] / [Reject]); once decided it shows the resolved state.
 * - `elicitation` ❓ — the agent asking the human a question; renders an inline reply box.
 * - `error` — a failure; carries the `destructive` tone and `role="alert"`.
 *
 * The approval and reply affordances are passed in as callbacks so the page owns the RPC +
 * pending/error state; this component is purely presentational beyond firing them.
 */
import type { SessionActivityOut } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { ApprovalStatusBadge } from './approval-status-badge';
import { relativeTime } from './format-time';

/** Read the free-text body off an activity (thought/response/elicitation/error). */
function textOf(activity: SessionActivityOut): string {
  const text = activity.body['text'];
  return typeof text === 'string' ? text : '';
}

/** Read the structured `action` payload off an `action` activity, when present. */
function actionOf(
  activity: SessionActivityOut,
): { kind: string; summary: string; diff?: unknown } | null {
  const action = activity.body['action'];
  if (action && typeof action === 'object' && 'summary' in action) {
    const value = action as { kind?: unknown; summary?: unknown; diff?: unknown };
    return {
      kind: typeof value.kind === 'string' ? value.kind : 'change',
      summary: typeof value.summary === 'string' ? value.summary : '',
      diff: value.diff,
    };
  }
  return null;
}

/** The leading glyph + accessible label for each activity type. */
const TYPE_BADGE: Record<SessionActivityOut['type'], { emoji: string; label: string }> = {
  thought: { emoji: '💭', label: 'Thought' },
  response: { emoji: '💬', label: 'Response' },
  action: { emoji: '⚙️', label: 'Action' },
  elicitation: { emoji: '❓', label: 'Question' },
  error: { emoji: '⛔', label: 'Error' },
};

/** Props for {@link ActivityItem}. */
export interface ActivityItemProps {
  /** The activity to render. */
  activity: SessionActivityOut;
  /** Whether the reviewer may act (approve/reject/reply) on this session. */
  canAct: boolean;
  /** Approve a proposed `action` activity. */
  onApprove: (activityId: string) => void;
  /** Reject a proposed `action` activity. */
  onReject: (activityId: string) => void;
  /** Reply to an `elicitation` activity with the given text. */
  onReply: (activityId: string, body: string) => void;
  /** Whether an approve/reject/reply call for this activity is in flight. */
  pending: boolean;
}

/**
 * A single, plain-English activity-stream entry with its type-specific affordances.
 */
export function ActivityItem({
  activity,
  canAct,
  onApprove,
  onReject,
  onReply,
  pending,
}: ActivityItemProps): JSX.Element {
  const badge = TYPE_BADGE[activity.type];
  const action = activity.type === 'action' ? actionOf(activity) : null;
  const text =
    activity.type === 'error' ? 'Athena could not complete that step.' : textOf(activity);

  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="bg-surface-container text-on-surface-variant text-body flex h-7 w-7 shrink-0 items-center justify-center rounded-full leading-none"
      >
        {badge.emoji}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-1">
        <div className="flex items-center gap-2">
          <span className="text-on-surface-variant text-xs font-medium">{badge.label}</span>
          <span className="text-on-surface-variant/70 text-xs">
            {relativeTime(activity.createdAt)}
          </span>
        </div>

        {/* Body. */}
        {activity.type === 'error' ? (
          <p role="alert" className="text-destructive text-body leading-relaxed">
            {text}
          </p>
        ) : activity.type === 'thought' ? (
          <ThoughtBody text={text} />
        ) : action ? (
          <ActionBody
            activityId={activity.id}
            kind={action.kind}
            summary={action.summary}
            diff={action.diff}
            approvalStatus={activity.approvalStatus ?? null}
            canAct={canAct}
            pending={pending}
            onApprove={onApprove}
            onReject={onReject}
          />
        ) : (
          <p className="text-on-surface text-body leading-relaxed whitespace-pre-wrap">{text}</p>
        )}

        {/* Elicitation reply affordance. */}
        {activity.type === 'elicitation' ? (
          <ReplyBox activityId={activity.id} canAct={canAct} pending={pending} onReply={onReply} />
        ) : null}
      </div>
    </li>
  );
}

/** The rendered body of an `action` activity — its summary plus the approval gate. */
function ActionBody({
  activityId,
  kind,
  summary,
  diff,
  approvalStatus,
  canAct,
  pending,
  onApprove,
  onReject,
}: {
  activityId: string;
  kind: string;
  summary: string;
  diff: unknown;
  approvalStatus: SessionActivityOut['approvalStatus'] | null;
  canAct: boolean;
  pending: boolean;
  onApprove: (activityId: string) => void;
  onReject: (activityId: string) => void;
}): JSX.Element {
  const isProposed = approvalStatus === 'proposed';
  const [showDiff, setShowDiff] = useState(false);

  // An applied action is history, not a decision — render it as one quiet chip line
  // (“Searched tasks · done”) so proposals stay the stream's only loud element.
  if (approvalStatus === 'applied') {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="border-outline-variant bg-surface-container text-on-surface-variant inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs">
          <code className="shrink-0">{kind}</code>
          <span className="truncate">{summary === kind ? 'done' : summary}</span>
        </span>
        <ApprovalStatusBadge status={approvalStatus} />
      </div>
    );
  }
  const diffText =
    diff === undefined || diff === null
      ? null
      : typeof diff === 'string'
        ? diff
        : JSON.stringify(diff, null, 2);

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        // A proposed action is the one row that needs a human — give it a stronger fill and a
        // primary left accent so it reads as the focal point of the stream, not a faint tint.
        isProposed
          ? 'border-primary/40 bg-primary/10 border-l-primary border-l-2'
          : 'border-outline-variant bg-surface-container',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <code className="text-on-surface-variant text-xs">{kind}</code>
          <p className="text-on-surface text-body leading-relaxed">{summary}</p>
        </div>
        <ApprovalStatusBadge status={approvalStatus} />
      </div>

      {diffText !== null ? (
        <div className="mt-2">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => {
              setShowDiff((open) => !open);
            }}
            aria-expanded={showDiff}
          >
            {showDiff ? 'Hide details' : 'Review details'}
          </Button>
          {showDiff ? (
            <pre className="border-outline-variant bg-surface-container-high text-on-surface-variant mt-1.5 max-h-48 overflow-auto rounded-md border p-2 text-xs whitespace-pre-wrap">
              {diffText}
            </pre>
          ) : null}
        </div>
      ) : null}

      {isProposed && canAct ? (
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              onApprove(activityId);
            }}
          >
            {pending ? 'Approving…' : 'Approve ▸'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              onReject(activityId);
            }}
          >
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The inline reply box shown under an `elicitation`. */
function ReplyBox({
  activityId,
  canAct,
  pending,
  onReply,
}: {
  activityId: string;
  canAct: boolean;
  pending: boolean;
  onReply: (activityId: string, body: string) => void;
}): JSX.Element | null {
  const [value, setValue] = useState('');
  if (!canAct) return null;

  const trimmed = value.trim();
  return (
    <form
      className="mt-1.5 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed.length === 0) return;
        onReply(activityId, trimmed);
        setValue('');
      }}
    >
      <textarea
        aria-label="Reply to the agent's question"
        placeholder="Reply to steer the agent…"
        rows={2}
        value={value}
        disabled={pending}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        className={cn(
          'border-outline-variant bg-surface-container placeholder:text-on-surface-variant focus-visible:ring-ring text-body w-full resize-y rounded-md border px-3 py-2',
          'transition-colors outline-none focus-visible:ring-1 disabled:opacity-50',
        )}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending || trimmed.length === 0}>
          {pending ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}

/** A thought: quiet italic reasoning; long ones fold to a single expandable line. */
function ThoughtBody({ text }: { text: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 160;
  if (!long) {
    return <p className="text-on-surface-variant text-body leading-relaxed italic">{text}</p>;
  }
  return (
    <button
      type="button"
      onClick={() => {
        setExpanded((open) => !open);
      }}
      aria-expanded={expanded}
      className={cn(
        'text-on-surface-variant text-body min-w-0 text-left leading-relaxed italic',
        'focus-visible:ring-ring rounded outline-none focus-visible:ring-1',
        expanded ? '' : 'truncate',
      )}
      title={expanded ? 'Collapse' : 'Expand the full reasoning'}
    >
      {text}
    </button>
  );
}
