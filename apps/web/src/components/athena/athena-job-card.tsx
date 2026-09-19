'use client';

/**
 * `athena-job-card` — one piece of delegated work, rendered as a flat work entry.
 *
 * @remarks
 * A list row with a body, not a card: an 8px state dot in a 24px gutter, a one-line title with its
 * time and an always-present overflow menu, one state line, then the decision (waiting) or receipt
 * (finished), then the step disclosure. It renders the same in the rail, the wide view's ledger,
 * and a task page, and never grows past a 640px measure. See "What to build instead" §1 of
 * `docs/design/audits/2026-09-18-athena-companion.md`.
 *
 * The entry fetches its own detail lazily ({@link personalAthenaDetailDef}) and drives its own
 * actions ({@link useAthenaActions}), so any host can drop one in without threading session state
 * down. Its ids are scoped per render with `useId`, so two hosts showing the same job never share
 * an id; a host that needs to find the entry reads `data-athena-job` inside its own container.
 */
import { useQueryClient } from '@tanstack/react-query';
import { relativeTime } from '@docket/ui';
import { RelativeTime } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useId, useState } from 'react';

import { useMentionOrgId } from '@/components/mentions/use-mention-org';
import {
  athenaQueueState,
  type AthenaQueueState,
  type PersonalAthenaSessionDetail,
  type PersonalAthenaSessionSummary,
  type PersonalAthenaStatus,
} from '@/lib/athena/presentation';
import { jobStatusLine, jobTone, type JobTone } from '@/lib/athena/job-presentation';
import {
  personalAthenaDetailDef,
  personalAthenaTransport,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import { queryKeys, useApiQuery } from '@/lib/query';

import { JobCardBody, type JobMenuAction, JobOverflowMenu, JobReplyForm } from './job-card-parts';
import { useAthenaActions } from './use-athena-actions';

/** Props for {@link AthenaJobCard}. */
export interface AthenaJobCardProps {
  /** The queue row this entry renders and keeps live. */
  readonly job: PersonalAthenaSessionSummary;
  readonly transport?: PersonalAthenaTransport;
  /** Override the `<article>` id, for a host that anchors a link to it. */
  readonly id?: string;
  /** Extra classes for the entry's root, e.g. a host's own vertical rhythm. */
  readonly className?: string;
}

/** Statuses a job never leaves: no more lifecycle actions, and no more Reply. */
const TERMINAL_STATUSES: ReadonlySet<PersonalAthenaStatus> = new Set([
  'completed',
  'failed',
  'canceled',
]);

/** The state dot's fill for each tone: solid primary while open, muted when done, error stopped. */
const DOT_CLASS_BY_TONE: Readonly<Record<JobTone, string>> = {
  attention: 'bg-primary',
  active: 'bg-primary animate-pulse motion-reduce:animate-none',
  done: 'bg-on-surface-variant/30',
  stopped: 'bg-error',
};

/** The overflow menu's permissions, derived from a job's current status. */
interface JobPermissions {
  readonly isFinished: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canCancel: boolean;
}

/**
 * Derive what a job's overflow menu may offer from its current lifecycle status — the caller's
 * "current" is the live status, not necessarily the summary's, since the loaded detail can have
 * moved on (e.g. a decision that just carried the job from `awaiting_approval` to `running`).
 */
function jobPermissions(
  status: PersonalAthenaStatus,
  queueState: AthenaQueueState,
): JobPermissions {
  return {
    isFinished: TERMINAL_STATUSES.has(status),
    canPause: status === 'running',
    canResume: status === 'awaiting_input',
    canCancel: queueState !== 'finished',
  };
}

/** Props for {@link JobTitleLine}. */
interface JobTitleLineProps {
  readonly titleId: string;
  readonly objective: string;
  readonly createdAt: string;
  readonly permissions: JobPermissions;
  readonly onAction: (action: JobMenuAction) => void;
}

/** Line 1: the objective, when it started, and the overflow menu that never moves. */
function JobTitleLine({
  titleId,
  objective,
  createdAt,
  permissions,
  onAction,
}: JobTitleLineProps): JSX.Element {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <h3 id={titleId} className="text-on-surface text-title-small min-w-0 flex-1 truncate">
        {objective}
      </h3>
      <RelativeTime iso={createdAt} className="text-on-surface-variant text-label-small shrink-0">
        {relativeTime(createdAt)}
      </RelativeTime>
      <JobOverflowMenu
        canPause={permissions.canPause}
        canResume={permissions.canResume}
        canCancel={permissions.canCancel}
        canReply={!permissions.isFinished}
        onAction={onAction}
      />
    </div>
  );
}

/** A job's loaded detail, its actions, and the state both derive. */
interface JobEntryState {
  readonly detail: PersonalAthenaSessionDetail | undefined;
  readonly actions: ReturnType<typeof useAthenaActions>;
  readonly tone: JobTone;
  readonly permissions: JobPermissions;
}

/**
 * Load one job's detail, poll it while it runs, and wire its actions.
 *
 * @remarks
 * The detail can outpace the summary the host handed us — e.g. right after a decision carries the
 * job from `awaiting_approval` to `running` — so the dot, the menu, and the poll cadence all follow
 * the loaded detail's status once it exists.
 */
function useJobEntry(
  job: PersonalAthenaSessionSummary,
  transport: PersonalAthenaTransport,
): JobEntryState {
  const queryClient = useQueryClient();
  const detail = useApiQuery({
    ...personalAthenaDetailDef(job.id, transport, true),
    refetchInterval: (query) =>
      jobTone(query.state.data?.status ?? job.status) === 'active' ? 3_000 : false,
  });
  const actions = useAthenaActions({
    selectedId: job.id,
    transport,
    onSelected: (next) => {
      queryClient.setQueryData(queryKeys.athenaSession(next.id), next);
    },
  });
  const liveStatus: PersonalAthenaStatus = detail.data?.status ?? job.status;
  const liveQueueState: AthenaQueueState =
    detail.data?.queueState ?? job.queueState ?? athenaQueueState(liveStatus);
  return {
    detail: detail.data,
    actions,
    tone: jobTone(liveStatus),
    permissions: jobPermissions(liveStatus, liveQueueState),
  };
}

/**
 * One piece of delegated work as a flat entry: title line, state line, decision or receipt, and
 * steps — with no badge, no box, and no permanent Reply.
 */
export function AthenaJobCard({
  job,
  transport = personalAthenaTransport,
  id,
  className,
}: AthenaJobCardProps): JSX.Element {
  const { detail, actions, tone, permissions } = useJobEntry(job, transport);
  const mentionOrgId = useMentionOrgId(job.workspace?.id);
  const [replyOpen, setReplyOpen] = useState(false);

  const scope = useId();
  const articleId = id ?? `athena-job-${scope}`;
  const titleId = `${articleId}-title`;

  function handleAction(action: JobMenuAction): void {
    if (action === 'reply') {
      setReplyOpen(true);
      return;
    }
    actions.lifecycle(action);
  }

  return (
    <article
      id={articleId}
      aria-labelledby={titleId}
      data-athena-job={job.id}
      data-state={tone}
      className={cn('relative flex w-full max-w-160 flex-col gap-2 py-3 pl-6', className)}
    >
      <span
        aria-hidden="true"
        data-slot="athena-job-dot"
        className={cn('absolute top-6 left-2 size-2 rounded-full', DOT_CLASS_BY_TONE[tone])}
      />
      <JobTitleLine
        titleId={titleId}
        objective={job.objective}
        createdAt={job.createdAt}
        permissions={permissions}
        onAction={handleAction}
      />
      <p data-slot="athena-job-state" className="text-on-surface-variant text-body-small -mt-1">
        {jobStatusLine(detail ?? null, job)}
      </p>
      {replyOpen && !permissions.isFinished ? (
        <JobReplyForm
          pending={actions.pending}
          mentionOrgId={mentionOrgId}
          onSend={(body) => {
            actions.sendMessage(body);
            setReplyOpen(false);
          }}
        />
      ) : null}
      <JobCardBody
        detail={detail}
        isFinished={permissions.isFinished}
        showReceipt={tone === 'done'}
        mentionOrgId={mentionOrgId}
        pending={actions.pending}
        undoPending={actions.undoPending}
        onChoose={(decision, optionId) => {
          actions.decide({ id: decision.id, option: optionId, kind: decision.kind });
        }}
        onAnswer={(decision, body) => {
          actions.decide({ id: decision.id, option: body, kind: decision.kind });
        }}
        onUndo={(changeSetId, onReverted) => {
          actions.undo(changeSetId, { onSuccess: onReverted });
        }}
      />
    </article>
  );
}
