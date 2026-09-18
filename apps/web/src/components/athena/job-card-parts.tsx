'use client';

/**
 * Small pieces of {@link AthenaJobCard}, split out to keep the card's own file under the
 * complexity and length ceilings.
 *
 * @remarks
 * Each piece owns one section of the card — the step list (with its own collapse state), the
 * pending decision, the finished receipt, and the reply control — and takes plain data and
 * callbacks rather than reaching for `useAthenaActions` or the detail query itself. That keeps
 * them easy to test in isolation and reusable from any future job surface (e.g. the task page's
 * own card, per §4.6 of the design spec).
 */
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  surfaceToneColor,
} from '@docket/ui/primitives';
import { MoreHorizontal } from '@docket/ui/icons';
import { type JSX, type SyntheticEvent, useMemo, useState } from 'react';

import { McpAppPresentationCard } from '@/components/athena/mcp-app-presentation-card';
import MentionTextarea from '@/components/mentions/mention-textarea';
import {
  presentAthenaActivity,
  type AthenaActivityPresentation,
  type PersonalAthenaDecision,
  type PersonalAthenaSessionDetail,
  type PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';
import { jobStatusLine } from '@/lib/athena/job-presentation';
import { postWidgetMessage } from '@/lib/athena/mcp-app-defs';

/**
 * Shared field chrome for the one-line answer/reply controls below.
 *
 * @remarks
 * No border: design-system §8 draws grouping from a tonal step on the surface ramp rather than a
 * drawn line, so the field sits transparent inside a {@link surfaceToneColor}`('card')` container
 * (see the call sites below) and the affordance is the tonal fill plus the focus ring.
 */
const MENTION_FIELD_CLASS =
  'text-on-surface placeholder:text-on-surface-variant focus-visible:ring-ring text-body-medium min-h-10 w-full resize-none rounded-lg bg-transparent px-3 py-2 outline-none focus-visible:ring-2 disabled:opacity-60';

/** How many of the newest steps a running job shows before offering "Show all". */
const COLLAPSED_STEP_COUNT = 3;

/** A lifecycle command the overflow menu can send. */
export type JobLifecycleAction = 'pause' | 'resume' | 'cancel';

/** Props for {@link JobLifecycleMenu}. */
export interface JobLifecycleMenuProps {
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canCancel: boolean;
  readonly onLifecycle: (action: JobLifecycleAction) => void;
}

/**
 * The card's overflow menu — an icon button named "More" holding whichever of Pause, Resume, and
 * Cancel currently apply. Renders nothing once none of them do (a finished job).
 */
export function JobLifecycleMenu({
  canPause,
  canResume,
  canCancel,
  onLifecycle,
}: JobLifecycleMenuProps): JSX.Element | null {
  if (!canPause && !canResume && !canCancel) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" iconOnly aria-label="More">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canPause ? (
          <DropdownMenuItem
            onSelect={() => {
              onLifecycle('pause');
            }}
          >
            Pause
          </DropdownMenuItem>
        ) : null}
        {canResume ? (
          <DropdownMenuItem
            onSelect={() => {
              onLifecycle('resume');
            }}
          >
            Resume
          </DropdownMenuItem>
        ) : null}
        {canCancel ? (
          <DropdownMenuItem
            onSelect={() => {
              onLifecycle('cancel');
            }}
          >
            Cancel
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Props for {@link JobSteps}. */
export interface JobStepsProps {
  /** The card's steps, oldest first — the same shape the workbench's work log renders. */
  readonly activities: readonly AthenaActivityPresentation[];
  /** Show every step regardless of count: the job is finished, or the card was asked to expand. */
  readonly forceExpanded: boolean;
}

/**
 * The card's step list: title, detail, an MCP app card when the tool call left one, and the
 * technical disclosure — lifted from the workbench's work log and relabelled "What Athena used".
 *
 * @remarks
 * A running job collapses to its newest {@link COLLAPSED_STEP_COUNT} steps behind a "Show all N"
 * control, so a long-running job's card does not grow without bound in the thread; a finished job,
 * or one the caller has already expanded, shows every step.
 */
export function JobSteps({ activities, forceExpanded }: JobStepsProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  if (activities.length === 0) return null;

  const collapsed = !forceExpanded && !expanded && activities.length > COLLAPSED_STEP_COUNT;
  const visible = collapsed ? activities.slice(-COLLAPSED_STEP_COUNT) : activities;

  return (
    <ol aria-label="What Athena did" className="divide-outline-variant divide-y">
      {collapsed ? (
        <li className="pb-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-10"
            onClick={() => {
              setExpanded(true);
            }}
          >
            {`Show all ${String(activities.length)}`}
          </Button>
        </li>
      ) : null}
      {visible.map((entry) => (
        <li key={entry.id} className="py-3 first:pt-0">
          <p className="text-on-surface text-body-medium break-words">{entry.title}</p>
          {entry.detail ? (
            <p className="text-on-surface-variant text-body-medium mt-0.5 break-words whitespace-pre-wrap">
              {entry.detail}
            </p>
          ) : null}
          {entry.presentation ? (
            <div className="mt-3">
              <McpAppPresentationCard
                presentation={entry.presentation}
                activityId={entry.id}
                onMessage={postWidgetMessage}
              />
            </div>
          ) : entry.presentationUnavailable ? (
            <p
              className="text-on-surface-variant text-body-small mt-2"
              data-testid="mcp-app-view-failure"
            >
              Interactive view unavailable.
            </p>
          ) : null}
          {entry.technical ? (
            <details className="text-on-surface-variant text-body-small mt-2">
              <summary className="focus-visible:ring-ring min-h-10 w-fit cursor-pointer py-2 focus-visible:ring-2 focus-visible:outline-none">
                What Athena used
              </summary>
              <pre
                className={cn(
                  surfaceToneColor('floating'),
                  'text-label-small mt-1 max-w-full overflow-x-auto rounded-md p-3',
                )}
              >
                {JSON.stringify(entry.technical, null, 2)}
              </pre>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Props for {@link JobDecision}. */
export interface JobDecisionProps {
  readonly decision: PersonalAthenaDecision;
  readonly pending: boolean;
  readonly mentionOrgId: string | undefined;
  readonly onChoose: (optionId: string) => void;
  readonly onAnswer: (body: string) => void;
}

/**
 * The pending decision block: title, description, and either option buttons or, for an optionless
 * question, a one-line free-text answer field.
 */
export function JobDecision({
  decision,
  pending,
  mentionOrgId,
  onChoose,
  onAnswer,
}: JobDecisionProps): JSX.Element {
  const freeform = decision.kind === 'question' && decision.options.length === 0;
  const [draft, setDraft] = useState('');

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = draft.trim();
    if (!body || pending) return;
    onAnswer(body);
    setDraft('');
  }

  return (
    <div className="bg-primary-container/25 rounded-md p-3">
      <h4 className="text-on-surface text-title-small">{decision.title}</h4>
      {decision.description ? (
        <p className="text-on-surface-variant text-body-medium mt-1">{decision.description}</p>
      ) : null}
      {freeform ? (
        <form aria-label="Answer Athena" className="mt-3 flex items-end gap-2" onSubmit={submit}>
          <label className={cn(surfaceToneColor('card'), 'min-w-0 flex-1 rounded-lg')}>
            <span className="sr-only">Answer Athena</span>
            <MentionTextarea
              aria-label="Answer Athena"
              value={draft}
              disabled={pending}
              rows={1}
              onChange={setDraft}
              {...(mentionOrgId === undefined ? {} : { orgId: mentionOrgId })}
              insertMode="context"
              className={MENTION_FIELD_CLASS}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            className="min-h-10"
            disabled={pending || draft.trim().length === 0}
          >
            Send
          </Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {decision.options.map((option, index) => (
            <Button
              key={option.id}
              type="button"
              variant={index === 0 ? 'default' : 'outline'}
              size="sm"
              className="min-h-10"
              disabled={pending}
              onClick={() => {
                onChoose(option.id);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Props for {@link JobReceipt}. */
export interface JobReceiptProps {
  readonly result: NonNullable<PersonalAthenaSessionDetail['result']>;
}

/** The finished job's receipt: title, summary, and the receipt rows as a `dt`/`dd` list. */
export function JobReceipt({ result }: JobReceiptProps): JSX.Element {
  return (
    <div className={cn(surfaceToneColor('card'), 'rounded-md p-3')}>
      <h4 className="text-on-surface text-title-small">{result.title}</h4>
      <p className="text-on-surface-variant text-body-medium mt-1">{result.summary}</p>
      {result.receipt && result.receipt.length > 0 ? (
        <dl className="divide-outline-variant mt-3 divide-y">
          {result.receipt.map((item) => (
            <div
              key={`${item.label}-${item.value}`}
              className="text-body-medium grid gap-1 py-2 sm:grid-cols-[10rem_1fr]"
            >
              <dt className="text-on-surface-variant">{item.label}</dt>
              <dd className="text-on-surface break-words">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Props for {@link JobReply}. */
export interface JobReplyProps {
  readonly pending: boolean;
  readonly mentionOrgId: string | undefined;
  readonly onSend: (body: string) => void;
}

/**
 * A running card's Reply control: a quiet "Reply" button that opens into a one-line
 * {@link MentionTextarea} and a Send button, and collapses again once the message is sent.
 */
export function JobReply({ pending, mentionOrgId, onSend }: JobReplyProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = draft.trim();
    if (!body || pending) return;
    onSend(body);
    setDraft('');
    setOpen(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-10 w-fit"
        onClick={() => {
          setOpen(true);
        }}
      >
        Reply
      </Button>
    );
  }

  return (
    <form aria-label="Reply" className="flex items-end gap-2" onSubmit={submit}>
      <label className={cn(surfaceToneColor('card'), 'min-w-0 flex-1 rounded-lg')}>
        <span className="sr-only">Reply</span>
        <MentionTextarea
          aria-label="Reply"
          value={draft}
          disabled={pending}
          rows={1}
          onChange={setDraft}
          {...(mentionOrgId === undefined ? {} : { orgId: mentionOrgId })}
          insertMode="context"
          className={MENTION_FIELD_CLASS}
        />
      </label>
      <Button
        type="submit"
        size="sm"
        className="min-h-10"
        disabled={pending || draft.trim().length === 0}
      >
        Send
      </Button>
    </form>
  );
}

/** Props for {@link JobCardBody}. */
export interface JobCardBodyProps {
  /** The queue row this body renders, for the status line's fallback and the reply/answer target. */
  readonly job: PersonalAthenaSessionSummary;
  /** The loaded detail, or `undefined` while the card's own query is still resolving. */
  readonly detail: PersonalAthenaSessionDetail | undefined;
  /** The job has left every lifecycle state: no more steps grow, and Reply is hidden. */
  readonly isFinished: boolean;
  /** Show every step even before the job finishes. */
  readonly expanded: boolean;
  readonly mentionOrgId: string | undefined;
  readonly pending: boolean;
  readonly onChoose: (decision: PersonalAthenaDecision, optionId: string) => void;
  readonly onAnswer: (decision: PersonalAthenaDecision, body: string) => void;
  readonly onSend: (body: string) => void;
}

/**
 * The card's body below the header: the live status line, its steps, a pending decision or
 * finished receipt, and — while the job is still open — a Reply control.
 *
 * @remarks
 * Split out of {@link AthenaJobCard} so that card's own function stays a thin composition of
 * hooks and this body; every branch that depends on the loaded detail (a decision, a result, the
 * step list) lives here instead.
 */
export function JobCardBody({
  job,
  detail,
  isFinished,
  expanded,
  mentionOrgId,
  pending,
  onChoose,
  onAnswer,
  onSend,
}: JobCardBodyProps): JSX.Element {
  const activities: readonly AthenaActivityPresentation[] = useMemo(() => {
    const raw = detail?.activities ?? [];
    return raw
      .map(presentAthenaActivity)
      .filter((entry): entry is AthenaActivityPresentation => entry !== null);
  }, [detail?.activities]);

  const decision = detail?.decision ?? null;
  const result = detail?.result ?? null;

  return (
    <>
      <p className="text-body-small text-on-surface-variant">
        {jobStatusLine(detail ?? null, job)}
      </p>

      <JobSteps activities={activities} forceExpanded={expanded || isFinished} />

      {decision ? (
        <JobDecision
          decision={decision}
          pending={pending}
          mentionOrgId={mentionOrgId}
          onChoose={(optionId) => {
            onChoose(decision, optionId);
          }}
          onAnswer={(body) => {
            onAnswer(decision, body);
          }}
        />
      ) : null}

      {result ? <JobReceipt result={result} /> : null}

      {isFinished ? null : (
        <JobReply pending={pending} mentionOrgId={mentionOrgId} onSend={onSend} />
      )}
    </>
  );
}
