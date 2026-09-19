'use client';

/**
 * The lines of one work entry below its title: the decision, the receipt, and the reply field.
 *
 * @remarks
 * Split out of {@link AthenaJobCard} so each piece owns one line of the entry's anatomy and takes
 * plain data and callbacks rather than reaching for `useAthenaActions` or the detail query itself.
 * That keeps them testable in isolation and reusable from any host that renders a work entry — the
 * rail's thread, the wide view's ledger, and a task page. See "What to build instead" §1 of
 * `docs/design/audits/2026-09-18-athena-companion.md`.
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
import { type JSX, type SyntheticEvent, useEffect, useMemo, useRef, useState } from 'react';

import { JobSteps, newestChangeSetId, StepUndo } from '@/components/athena/job-card-steps';
import { ProposalInputRows } from '@/components/athena/proposal-input-rows';
import { taskIdsFromInput, useHighlightHandlers } from '@/components/athena/proposal-highlight';
import MentionTextarea from '@/components/mentions/mention-textarea';
import { isOutwardProposal } from '@/lib/athena/describe-proposal';
import {
  presentAthenaActivity,
  type AthenaActivityPresentation,
  type PersonalAthenaDecision,
  type PersonalAthenaSessionDetail,
} from '@/lib/athena/presentation';
import {
  decisionSentence,
  jobChanges,
  jobFailureCause,
  type JobChange,
} from '@/lib/athena/job-presentation';

/**
 * Shared field chrome for the one-line answer/reply fields below.
 *
 * @remarks
 * No border: the field sits transparent inside a {@link surfaceToneColor}`('card')` container and
 * its affordance is the tonal fill plus the focus ring.
 */
const MENTION_FIELD_CLASS =
  'text-on-surface placeholder:text-on-surface-variant focus-visible:ring-ring text-body-medium min-h-10 w-full resize-none rounded-lg bg-transparent px-3 py-2 outline-none focus-visible:ring-2 disabled:opacity-60';

/** A command the overflow menu can send: a lifecycle change, or opening the reply field. */
export type JobMenuAction = 'pause' | 'resume' | 'cancel' | 'reply';

/** A lifecycle command the overflow menu can send. */
export type JobLifecycleAction = Exclude<JobMenuAction, 'reply'>;

/** Props for {@link JobOverflowMenu}. */
export interface JobOverflowMenuProps {
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canCancel: boolean;
  readonly canReply: boolean;
  readonly onAction: (action: JobMenuAction) => void;
}

/** The overflow menu's items, in the order they appear. */
const MENU_ITEMS: readonly { readonly action: JobMenuAction; readonly label: string }[] = [
  { action: 'reply', label: 'Reply' },
  { action: 'pause', label: 'Pause' },
  { action: 'resume', label: 'Resume' },
  { action: 'cancel', label: 'Cancel' },
];

/**
 * The title line's trailing "More" menu: Reply, Pause, Resume, and Cancel, whichever apply.
 *
 * @remarks
 * Always rendered, so its position never moves between states; disabled when a finished entry has
 * nothing to offer.
 */
export function JobOverflowMenu({
  canPause,
  canResume,
  canCancel,
  canReply,
  onAction,
}: JobOverflowMenuProps): JSX.Element {
  const allowed: Readonly<Record<JobMenuAction, boolean>> = {
    reply: canReply,
    pause: canPause,
    resume: canResume,
    cancel: canCancel,
  };
  const items = MENU_ITEMS.filter((item) => allowed[item.action]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={items.length === 0}>
        <Button
          type="button"
          variant="ghost"
          controlSize="md"
          iconOnly
          aria-label="More"
          className="text-on-surface-variant shrink-0"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.action}
            onSelect={() => {
              onAction(item.action);
            }}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The newest `tool`-kind step, or `undefined` when the entry has taken none yet. */
function newestToolStep(
  activities: readonly AthenaActivityPresentation[],
): AthenaActivityPresentation | undefined {
  return activities.filter((entry) => entry.kind === 'tool').at(-1);
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
 * decision is read from that step rather than from the decision.
 */
export function outwardDecisionInput(
  activities: readonly AthenaActivityPresentation[],
): Record<string, unknown> | null {
  const toolName = newestToolStep(activities)?.technical?.toolName;
  if (!toolName || !isOutwardProposal({ tool: toolName })) return null;
  return newestToolInput(activities);
}

/** Props for {@link OneLineForm}. */
interface OneLineFormProps {
  /** The form's accessible name, also the field's. */
  readonly label: string;
  readonly pending: boolean;
  readonly mentionOrgId: string | undefined;
  readonly onSubmit: (body: string) => void;
  readonly onFieldFocus?: (() => void) | undefined;
  readonly onFieldBlur?: (() => void) | undefined;
  /** Focus the field on mount — true when the person just asked for it. */
  readonly autoFocus?: boolean | undefined;
}

/** A one-line mention-aware field and its Send button. */
function OneLineForm({
  label,
  pending,
  mentionOrgId,
  onSubmit,
  onFieldFocus,
  onFieldBlur,
  autoFocus = false,
}: OneLineFormProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (autoFocus) formRef.current?.querySelector('textarea')?.focus();
  }, [autoFocus]);

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = draft.trim();
    if (!body || pending) return;
    onSubmit(body);
    setDraft('');
  }

  return (
    <form ref={formRef} aria-label={label} className="flex items-end gap-2" onSubmit={submit}>
      <label className={cn(surfaceToneColor('card'), 'min-w-0 flex-1 rounded-lg')}>
        <span className="sr-only">{label}</span>
        <MentionTextarea
          aria-label={label}
          value={draft}
          disabled={pending}
          rows={1}
          onChange={setDraft}
          {...(mentionOrgId === undefined ? {} : { orgId: mentionOrgId })}
          insertMode="context"
          className={MENTION_FIELD_CLASS}
          {...(onFieldFocus ? { onFocus: onFieldFocus } : {})}
          {...(onFieldBlur ? { onBlur: onFieldBlur } : {})}
        />
      </label>
      <Button
        type="submit"
        controlSize="md"
        disabled={pending || draft.trim().length === 0}
        {...(onFieldFocus ? { onFocus: onFieldFocus } : {})}
        {...(onFieldBlur ? { onBlur: onFieldBlur } : {})}
      >
        Send
      </Button>
    </form>
  );
}

/** Props for {@link JobReplyForm}. */
export interface JobReplyFormProps {
  readonly pending: boolean;
  readonly mentionOrgId: string | undefined;
  readonly onSend: (body: string) => void;
}

/** The reply field the overflow menu's Reply opens; it takes focus as it appears. */
export function JobReplyForm({ pending, mentionOrgId, onSend }: JobReplyFormProps): JSX.Element {
  return (
    <OneLineForm
      label="Reply"
      pending={pending}
      mentionOrgId={mentionOrgId}
      onSubmit={onSend}
      autoFocus
    />
  );
}

/** Props for {@link JobDecision}. */
export interface JobDecisionProps {
  readonly decision: PersonalAthenaDecision;
  /** The plain-language sentence for this decision — see {@link decisionSentence}. */
  readonly sentence: string;
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
  /** Mirrors the decision's pointer-hover highlight for keyboard focus of an option. */
  readonly onFocusRow: () => void;
  readonly onBlurRow: () => void;
}

/** The label the primary option shows: "Review" until the outward content has been read. */
function optionLabel(label: string, isPrimary: boolean, needsReview: boolean): string {
  return isPrimary && needsReview ? 'Review' : label;
}

/** The decision's buttons: the primary filled, the rest text buttons, all 32px tall. */
function JobDecisionOptions({
  options,
  pending,
  needsReview,
  onReview,
  onChoose,
  onFocusRow,
  onBlurRow,
}: JobDecisionOptionsProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((option, index) => {
        const isPrimary = index === 0;
        return (
          <Button
            key={option.id}
            type="button"
            variant={isPrimary ? 'default' : 'ghost'}
            controlSize="md"
            disabled={pending}
            onClick={() => {
              if (isPrimary && needsReview) {
                onReview();
                return;
              }
              onChoose(option.id);
            }}
            onFocus={onFocusRow}
            onBlur={onBlurRow}
          >
            {optionLabel(option.label, isPrimary, needsReview)}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * A waiting entry's decision: the change in plain words, then its buttons — or, for an optionless
 * question, a one-line answer field. An outward change's primary button reads "Review" and reveals
 * what would go out before it reads "Approve".
 */
export function JobDecision({
  decision,
  sentence,
  pending,
  mentionOrgId,
  outwardInput,
  targetIds,
  onChoose,
  onAnswer,
}: JobDecisionProps): JSX.Element {
  const freeform = decision.kind === 'question' && decision.options.length === 0;
  const [reviewed, setReviewed] = useState(false);
  const highlight = useHighlightHandlers(targetIds);

  return (
    <div
      data-slot="athena-job-decision"
      className="flex flex-col gap-2"
      onPointerEnter={highlight.onPointerEnter}
      onPointerLeave={highlight.onPointerLeave}
    >
      <p className="text-on-surface text-body-medium break-words">{sentence}</p>
      {decision.description ? (
        <p className="text-on-surface-variant text-body-small break-words">
          {decision.description}
        </p>
      ) : null}
      {outwardInput && reviewed ? (
        <ProposalInputRows input={outwardInput} className={surfaceToneColor('floating')} />
      ) : null}
      {freeform ? (
        <OneLineForm
          label="Answer"
          pending={pending}
          mentionOrgId={mentionOrgId}
          onSubmit={onAnswer}
          onFieldFocus={highlight.onFocus}
          onFieldBlur={highlight.onBlur}
        />
      ) : (
        <JobDecisionOptions
          options={decision.options}
          pending={pending}
          needsReview={outwardInput !== null && !reviewed}
          onReview={() => {
            setReviewed(true);
          }}
          onChoose={onChoose}
          onFocusRow={highlight.onFocus}
          onBlurRow={highlight.onBlur}
        />
      )}
    </div>
  );
}

/** Props for {@link JobReceipt}. */
export interface JobReceiptProps {
  /** The changes that landed, oldest first. */
  readonly changes: readonly JobChange[];
  /** What did not happen, when a step failed — see {@link jobFailureCause}. */
  readonly failureCause: string | null;
  /** The newest step's change set, when the finished work left one to undo. */
  readonly changeSetId: string | null;
  readonly undone: boolean;
  readonly undoPending: boolean;
  readonly onUndo: (changeSetId: string) => void;
}

/** Props for {@link ReceiptLines}. */
type ReceiptLinesProps = Pick<JobReceiptProps, 'changes' | 'failureCause'>;

/**
 * The receipt's lines: one per change, or the cause when a step failed and nothing landed.
 *
 * @remarks
 * "Nothing changed" is the state line's to say, so it is never repeated here; a run that changed
 * nothing and hit no error has no receipt line at all.
 */
function ReceiptLines({ changes, failureCause }: ReceiptLinesProps): JSX.Element | null {
  if (changes.length > 0) {
    return (
      <ul className="flex flex-col gap-1">
        {changes.map((change) => (
          <li key={change.id} className="text-on-surface-variant text-body-small break-words">
            {change.text}
          </li>
        ))}
      </ul>
    );
  }
  if (!failureCause) return null;
  return (
    <p data-slot="athena-job-cause" className="text-on-surface-variant text-body-small break-words">
      {failureCause}
    </p>
  );
}

/**
 * A finished entry's receipt: one line per change, then Undo. When nothing changed, the state line
 * already says so, and the receipt holds only the cause when a step failed.
 */
export function JobReceipt({
  changes,
  failureCause,
  changeSetId,
  undone,
  undoPending,
  onUndo,
}: JobReceiptProps): JSX.Element | null {
  if (changes.length === 0 && !failureCause && !changeSetId) return null;
  return (
    <div data-slot="athena-job-receipt" className="flex flex-col gap-1">
      <ReceiptLines changes={changes} failureCause={failureCause} />
      {changeSetId ? (
        <StepUndo changeSetId={changeSetId} undone={undone} pending={undoPending} onUndo={onUndo} />
      ) : null}
    </div>
  );
}

/** Props for {@link JobCardBody}. */
export interface JobCardBodyProps {
  /** The loaded detail, or `undefined` while the entry's own query is still resolving. */
  readonly detail: PersonalAthenaSessionDetail | undefined;
  /** The job has left every lifecycle state: a step's recorded change may be undone. */
  readonly isFinished: boolean;
  /** The job completed: its receipt renders. A stopped job's state line already says the outcome. */
  readonly showReceipt: boolean;
  readonly mentionOrgId: string | undefined;
  readonly pending: boolean;
  /** Whether an undo request is in flight, disabling every Undo control while it settles. */
  readonly undoPending: boolean;
  readonly onChoose: (decision: PersonalAthenaDecision, optionId: string) => void;
  readonly onAnswer: (decision: PersonalAthenaDecision, body: string) => void;
  /** Undo one change set; `onReverted` fires only once the request actually succeeds. */
  readonly onUndo: (changeSetId: string, onReverted: () => void) => void;
}

/** Props for {@link JobCardOutcome}. */
interface JobCardOutcomeProps {
  readonly detail: PersonalAthenaSessionDetail;
  readonly activities: readonly AthenaActivityPresentation[];
  readonly showReceipt: boolean;
  readonly pending: boolean;
  readonly mentionOrgId: string | undefined;
  readonly undoneChangeSetIds: ReadonlySet<string>;
  readonly undoPending: boolean;
  readonly onChoose: JobCardBodyProps['onChoose'];
  readonly onAnswer: JobCardBodyProps['onAnswer'];
  readonly onUndo: (changeSetId: string) => void;
}

/** A waiting entry's decision, or a finished entry's receipt — whichever the detail carries. */
function JobCardOutcome({
  detail,
  activities,
  showReceipt,
  pending,
  mentionOrgId,
  undoneChangeSetIds,
  undoPending,
  onChoose,
  onAnswer,
  onUndo,
}: JobCardOutcomeProps): JSX.Element | null {
  const decision = detail.decision ?? null;
  if (decision) {
    return (
      <JobDecision
        decision={decision}
        sentence={decisionSentence(detail)}
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
    );
  }
  if (!showReceipt) return null;
  const changeSetId = newestChangeSetId(activities);
  return (
    <JobReceipt
      changes={jobChanges(detail)}
      failureCause={jobFailureCause(detail)}
      changeSetId={changeSetId}
      undone={changeSetId !== null && undoneChangeSetIds.has(changeSetId)}
      undoPending={undoPending}
      onUndo={onUndo}
    />
  );
}

/**
 * The entry's lines below its state line: the decision or receipt, then the step disclosure.
 *
 * @remarks
 * Renders nothing but the disclosure until the detail loads — the title and state line above it
 * already say where the work stands.
 */
export function JobCardBody({
  detail,
  isFinished,
  showReceipt,
  mentionOrgId,
  pending,
  undoPending,
  onChoose,
  onAnswer,
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
      {detail ? (
        <JobCardOutcome
          detail={detail}
          activities={activities}
          showReceipt={showReceipt}
          pending={pending}
          mentionOrgId={mentionOrgId}
          undoneChangeSetIds={undoneChangeSetIds}
          undoPending={undoPending}
          onChoose={onChoose}
          onAnswer={onAnswer}
          onUndo={handleUndo}
        />
      ) : null}
      <JobSteps
        activities={activities}
        isFinished={isFinished}
        undoneChangeSetIds={undoneChangeSetIds}
        undoPending={undoPending}
        onUndo={handleUndo}
      />
    </>
  );
}
