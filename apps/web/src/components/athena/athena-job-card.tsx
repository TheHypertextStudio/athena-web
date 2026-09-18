'use client';

/**
 * `athena-job-card` — one piece of delegated work, rendered as a card in the thread.
 *
 * @remarks
 * A job is a `kind: 'job'` session read through the same personal queue and detail definitions as
 * the full Athena workspace. This card fetches its own detail lazily
 * ({@link personalAthenaDetailDef}) and drives its own actions ({@link useAthenaActions}), so
 * `AthenaConversation` and the wide Work ledger can drop one of these into the thread without
 * threading session state down from a parent. Its step list and receipt are the workbench's own
 * rendering, reduced to a card — see §4.2 and §4.6 of
 * `docs/superpowers/specs/2026-09-12-athena-companion-design.md`.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Badge, type BadgeVariant } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { useMentionOrgId } from '@/components/mentions/use-mention-org';
import {
  athenaQueueState,
  type AthenaQueueState,
  type PersonalAthenaSessionSummary,
  type PersonalAthenaStatus,
} from '@/lib/athena/presentation';
import { jobStateLabel, jobTone, type JobTone } from '@/lib/athena/job-presentation';
import {
  personalAthenaDetailDef,
  personalAthenaTransport,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import { queryKeys, useApiQuery } from '@/lib/query';

import { JobCardBody, type JobLifecycleAction, JobLifecycleMenu } from './job-card-parts';
import { useAthenaActions } from './use-athena-actions';

/** Props for {@link AthenaJobCard}. */
export interface AthenaJobCardProps {
  /** The queue row this card renders and keeps live. */
  readonly job: PersonalAthenaSessionSummary;
  readonly transport?: PersonalAthenaTransport;
  /** Show every step even before the job finishes, rather than the collapsed last few. */
  readonly expanded?: boolean;
  /** Override the `<article>` id, for a host that anchors scroll-to (e.g. the Working strip). */
  readonly id?: string;
}

/** Statuses a job never leaves: no more lifecycle actions, and no more Reply. */
const TERMINAL_STATUSES: ReadonlySet<PersonalAthenaSessionSummary['status']> = new Set([
  'completed',
  'failed',
  'canceled',
]);

/** The badge colour treatment for each tone — see {@link JobTone}. */
const BADGE_VARIANT_BY_TONE: Readonly<Record<JobTone, BadgeVariant>> = {
  attention: 'default',
  active: 'secondary',
  done: 'secondary',
  stopped: 'destructive',
};

/** The overflow menu's three permissions, derived from a job's current status. */
interface JobLifecyclePermissions {
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
function lifecyclePermissions(
  status: PersonalAthenaStatus,
  queueState: AthenaQueueState,
): JobLifecyclePermissions {
  return {
    isFinished: TERMINAL_STATUSES.has(status),
    canPause: status === 'running',
    canResume: status === 'awaiting_input',
    canCancel: queueState !== 'finished',
  };
}

/**
 * One piece of delegated work: the objective, a live status line, its steps, a pending decision or
 * finished receipt, and a Reply control — no "session", "job", "tool", "execute", or "queue" in
 * sight, and no type label on the card itself.
 */
export function AthenaJobCard({
  job,
  transport = personalAthenaTransport,
  expanded = false,
  id,
}: AthenaJobCardProps): JSX.Element {
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
  const mentionOrgId = useMentionOrgId(job.workspace?.id);

  const articleId = id ?? `athena-job-${job.id}`;
  const titleId = `${articleId}-title`;

  // The detail query can outpace the summary the host handed us — e.g. right after a decision
  // carries the job from `awaiting_approval` to `running` — so the badge, the menu, and the poll
  // cadence all follow the loaded detail's status once it exists, falling back to the summary
  // only until that first load resolves.
  const liveStatus: PersonalAthenaStatus = detail.data?.status ?? job.status;
  const liveQueueState: AthenaQueueState =
    detail.data?.queueState ?? job.queueState ?? athenaQueueState(liveStatus);
  const tone = jobTone(liveStatus);
  const permissions = lifecyclePermissions(liveStatus, liveQueueState);

  function handleLifecycle(action: JobLifecycleAction): void {
    actions.lifecycle(action);
  }

  return (
    <article id={articleId} aria-labelledby={titleId} className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={BADGE_VARIANT_BY_TONE[tone]}>{jobStateLabel(liveStatus)}</Badge>
          <h3 id={titleId} className="text-on-surface text-title-medium min-w-0 break-words">
            {job.objective}
          </h3>
        </div>
        <JobLifecycleMenu
          canPause={permissions.canPause}
          canResume={permissions.canResume}
          canCancel={permissions.canCancel}
          onLifecycle={handleLifecycle}
        />
      </header>

      <JobCardBody
        job={job}
        detail={detail.data}
        isFinished={permissions.isFinished}
        expanded={expanded}
        mentionOrgId={mentionOrgId}
        pending={actions.pending}
        onChoose={(decision, optionId) => {
          actions.decide({ id: decision.id, option: optionId, kind: decision.kind });
        }}
        onAnswer={(decision, body) => {
          actions.decide({ id: decision.id, option: body, kind: decision.kind });
        }}
        onSend={(body) => {
          actions.sendMessage(body);
        }}
      />
    </article>
  );
}
