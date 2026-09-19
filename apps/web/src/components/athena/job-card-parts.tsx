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

import { JobSteps, newestChangeSetId, StepUndo } from '@/components/athena/job-card-steps';
import { ProposalInputRows } from '@/components/athena/proposal-input-rows';
import {
  EMPTY_HIGHLIGHTED_IDS,
  taskIdsFromInput,
  useSetHighlightedIds,
} from '@/components/athena/proposal-highlight';
import MentionTextarea from '@/components/mentions/mention-textarea';
import { isOutwardTool } from '@/lib/athena/describe-proposal';
import {
  presentAthenaActivity,
  type AthenaActivityPresentation,
  type PersonalAthenaDecision,
  type PersonalAthenaSessionDetail,
  type PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';
import { decisionSentence, jobStatusLine } from '@/lib/athena/job-presentation';

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

/** A lifecycle command the overflow menu can send. */
export type JobLifecycleAction = 'pause' | 'resume' | 'cancel';

/** Props for {@link JobLifecycleMenu}. */
export interface JobLifecycleMenuProps {
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canCancel: boolean;
  readonly onLifecycle: (action: JobLifecycleAction) => void;
  /** Extra classes for the trigger button, e.g. to keep it out of the heading row's flex flow. */
  readonly className?: string | undefined;
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
  className,
}: JobLifecycleMenuProps): JSX.Element | null {
  if (!canPause && !canResume && !canCancel) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" iconOnly aria-label="More" className={className}>
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

/** The newest `tool`-kind step, or `undefined` when the card has taken none yet. */
function newestToolStep(
  activities: readonly AthenaActivityPresentation[],
): AthenaActivityPresentation | undefined {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const entry = activities[index];
    if (entry?.kind === 'tool') return entry;
  }
  return undefined;
}

/** The newest tool step's raw input, regardless of whether that tool is outward. */
function newestToolInput(
  activities: readonly AthenaActivityPresentation[],
): Record<string, unknown> | null {
  const input = newestToolStep(activities)?.technical?.input;
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : null;
}

/**
 * The newest tool step's raw input, only when that step's tool leaves Docket.
 *
 * @remarks
 * The decision itself carries no tool name — only the newest tool step does — so an outward
 * decision is read from that step rather than from the decision, matching the plan's rule for the
 * job card's decision block.
 */
export function outwardDecisionInput(
  activities: readonly AthenaActivityPresentation[],
): Record<string, unknown> | null {
  const toolName = newestToolStep(activities)?.technical?.toolName;
  if (!toolName || !isOutwardTool(toolName)) return null;
  return newestToolInput(activities);
}

/** Props for {@link JobDecision}. */
export interface JobDecisionProps {
  readonly decision: PersonalAthenaDecision;
  /** The plain-language sentence for this decision's heading — see {@link decisionSentence}. */
  readonly title: string;
  readonly pending: boolean;
  readonly mentionOrgId: string | undefined;
  /** The proposed outward call's raw input, when the decision would send something out. */
  readonly outwardInput: Record<string, unknown> | null;
  /** The task id(s) this decision's underlying tool call would change, for the hover highlight. */
  readonly targetIds: ReadonlySet<string>;
  readonly onChoose: (optionId: string) => void;
  readonly onAnswer: (body: string) => void;
}

/** Props for {@link JobDecisionOptions}. */
interface JobDecisionOptionsProps {
  readonly options: PersonalAthenaDecision['options'];
  readonly pending: boolean;
  /** Whether the primary option still owes a Review before it may be chosen. */
  readonly needsReview: boolean;
  readonly onReview: () => void;
  readonly onChoose: (optionId: string) => void;
}

/** The decision's option buttons; the primary one reads "Review" until `needsReview` clears. */
function JobDecisionOptions({
  options,
  pending,
  needsReview,
  onReview,
  onChoose,
}: JobDecisionOptionsProps): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option, index) => {
        const isPrimary = index === 0;
        return (
          <Button
            key={option.id}
            type="button"
            variant={isPrimary ? 'default' : 'secondary'}
            size="sm"
            className="min-h-10"
            disabled={pending}
            onClick={() => {
              if (isPrimary && needsReview) {
                onReview();
                return;
              }
              onChoose(option.id);
            }}
          >
            {isPrimary && needsReview ? 'Review' : option.label}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * The pending decision block: title, description, and either option buttons or, for an optionless
 * question, a one-line free-text answer field. When the decision would run an outward tool, the
 * primary option reads "Review" and reveals what would go out before it reads "Approve".
 */
export function JobDecision({
  decision,
  title,
  pending,
  mentionOrgId,
  outwardInput,
  targetIds,
  onChoose,
  onAnswer,
}: JobDecisionProps): JSX.Element {
  const freeform = decision.kind === 'question' && decision.options.length === 0;
  const [draft, setDraft] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const setHighlighted = useSetHighlightedIds();

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = draft.trim();
    if (!body || pending) return;
    onAnswer(body);
    setDraft('');
  }

  return (
    <div
      className="flex flex-col gap-2"
      onPointerEnter={() => {
        if (targetIds.size > 0) setHighlighted(targetIds);
      }}
      onPointerLeave={() => {
        if (targetIds.size > 0) setHighlighted(EMPTY_HIGHLIGHTED_IDS);
      }}
    >
      <h4 className="text-on-surface text-title-small">{title}</h4>
      {decision.description ? (
        <p className="text-on-surface-variant text-body-medium">{decision.description}</p>
      ) : null}
      {outwardInput && reviewed ? (
        <ProposalInputRows input={outwardInput} className={surfaceToneColor('floating')} />
      ) : null}
      {freeform ? (
        <form aria-label="Answer Athena" className="flex items-end gap-2" onSubmit={submit}>
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
        <JobDecisionOptions
          options={decision.options}
          pending={pending}
          needsReview={outwardInput !== null && !reviewed}
          onReview={() => {
            setReviewed(true);
          }}
          onChoose={onChoose}
        />
      )}
    </div>
  );
}

/** Props for {@link JobReceipt}. */
export interface JobReceiptProps {
  readonly result: NonNullable<PersonalAthenaSessionDetail['result']>;
  /** The newest step's change set, when the finished work left one to undo. */
  readonly changeSetId: string | null;
  readonly undone: boolean;
  readonly undoPending: boolean;
  readonly onUndo: (changeSetId: string) => void;
}

/** The finished job's receipt: title, summary, the receipt rows as a `dt`/`dd` list, and Undo. */
export function JobReceipt({
  result,
  changeSetId,
  undone,
  undoPending,
  onUndo,
}: JobReceiptProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-on-surface text-title-small">{result.title}</h4>
      <p className="text-on-surface-variant text-body-medium">{result.summary}</p>
      {result.receipt && result.receipt.length > 0 ? (
        <dl>
          {result.receipt.map((item) => (
            <div
              key={`${item.label}-${item.value}`}
              className="text-body-medium grid gap-1 py-1 sm:grid-cols-[10rem_1fr]"
            >
              <dt className="text-on-surface-variant">{item.label}</dt>
              <dd className="text-on-surface break-words">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {changeSetId ? (
        <StepUndo changeSetId={changeSetId} undone={undone} pending={undoPending} onUndo={onUndo} />
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
  /** Whether an undo request is in flight, disabling every Undo control while it settles. */
  readonly undoPending: boolean;
  readonly onChoose: (decision: PersonalAthenaDecision, optionId: string) => void;
  readonly onAnswer: (decision: PersonalAthenaDecision, body: string) => void;
  readonly onSend: (body: string) => void;
  /** Undo one change set; `onReverted` fires only once the request actually succeeds. */
  readonly onUndo: (changeSetId: string, onReverted: () => void) => void;
}

/** Props for {@link JobCardDecisionAndReceipt}. */
interface JobCardDecisionAndReceiptProps {
  readonly detail: PersonalAthenaSessionDetail | undefined;
  readonly activities: readonly AthenaActivityPresentation[];
  readonly isFinished: boolean;
  readonly pending: boolean;
  readonly mentionOrgId: string | undefined;
  readonly undoneChangeSetIds: ReadonlySet<string>;
  readonly undoPending: boolean;
  readonly onChoose: (decision: PersonalAthenaDecision, optionId: string) => void;
  readonly onAnswer: (decision: PersonalAthenaDecision, body: string) => void;
  readonly onUndo: (changeSetId: string) => void;
}

/** The card's pending decision or finished receipt, whichever the loaded detail carries. */
function JobCardDecisionAndReceipt({
  detail,
  activities,
  isFinished,
  pending,
  mentionOrgId,
  undoneChangeSetIds,
  undoPending,
  onChoose,
  onAnswer,
  onUndo,
}: JobCardDecisionAndReceiptProps): JSX.Element {
  const decision = detail?.decision ?? null;
  const result = detail?.result ?? null;
  const receiptChangeSetId = isFinished ? newestChangeSetId(activities) : null;
  const receiptUndone = receiptChangeSetId !== null && undoneChangeSetIds.has(receiptChangeSetId);

  return (
    <>
      {decision && detail ? (
        <JobDecision
          decision={decision}
          title={decisionSentence(detail)}
          pending={pending}
          mentionOrgId={mentionOrgId}
          outwardInput={outwardDecisionInput(activities)}
          targetIds={taskIdsFromInput(newestToolInput(activities))}
          onChoose={(optionId) => {
            onChoose(decision, optionId);
          }}
          onAnswer={(body) => {
            onAnswer(decision, body);
          }}
        />
      ) : null}

      {result ? (
        <JobReceipt
          result={result}
          changeSetId={receiptChangeSetId}
          undone={receiptUndone}
          undoPending={undoPending}
          onUndo={onUndo}
        />
      ) : null}
    </>
  );
}

/**
 * The card's body below the header: the live status line, its steps, a pending decision or
 * finished receipt, and — while the job is still open — a Reply control.
 *
 * @remarks
 * Split out of {@link AthenaJobCard} so that card's own function stays a thin composition of
 * hooks and this body; every branch that depends on the loaded detail (a decision, a result, the
 * step list) lives in {@link JobCardDecisionAndReceipt} instead.
 */
export function JobCardBody({
  job,
  detail,
  isFinished,
  expanded,
  mentionOrgId,
  pending,
  undoPending,
  onChoose,
  onAnswer,
  onSend,
  onUndo,
}: JobCardBodyProps): JSX.Element {
  const [undoneChangeSetIds, setUndoneChangeSetIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const activities: readonly AthenaActivityPresentation[] = useMemo(() => {
    const raw = detail?.activities ?? [];
    return raw
      .map(presentAthenaActivity)
      .filter((entry): entry is AthenaActivityPresentation => entry !== null);
  }, [detail?.activities]);

  function handleUndo(changeSetId: string): void {
    onUndo(changeSetId, () => {
      setUndoneChangeSetIds((current) => new Set(current).add(changeSetId));
    });
  }

  return (
    <>
      <p className="text-body-medium text-on-surface-variant">
        {jobStatusLine(detail ?? null, job)}
      </p>

      <JobSteps
        activities={activities}
        forceExpanded={expanded || isFinished}
        isFinished={isFinished}
        undoneChangeSetIds={undoneChangeSetIds}
        undoPending={undoPending}
        onUndo={handleUndo}
      />

      <JobCardDecisionAndReceipt
        detail={detail}
        activities={activities}
        isFinished={isFinished}
        pending={pending}
        mentionOrgId={mentionOrgId}
        undoneChangeSetIds={undoneChangeSetIds}
        undoPending={undoPending}
        onChoose={onChoose}
        onAnswer={onAnswer}
        onUndo={handleUndo}
      />

      {isFinished ? null : (
        <JobReply pending={pending} mentionOrgId={mentionOrgId} onSend={onSend} />
      )}
    </>
  );
}
