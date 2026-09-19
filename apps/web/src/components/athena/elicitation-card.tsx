'use client';

/**
 * One elicitation, as a flat entry in the conversation.
 *
 * @remarks
 * The same anatomy as a work entry ({@link AthenaJobCard}), so a question and a piece of work read
 * as the same kind of thing: an 8px state dot in a 24px gutter, a one-line title, one state line,
 * then line 3 — the question and its controls while it waits, or the record of how it settled. No
 * surface, no badge, no chip.
 *
 * The title is the **action** — "Post the sprint update to the Acme project channel" — because the
 * thing being authorized is what a person needs to decide, and a bare question ("Which channel?")
 * does not tell them what happens next. The state line carries the deadline and a link to the task
 * the question unblocks. A settled question stays in place as a record rather than disappearing.
 */
import type { ElicitationOut } from '@docket/athena/elicitation-api';
import { relativeTime } from '@docket/ui';
import { RelativeTime } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import { Button, ControlGroup, FieldError, surfaceToneColor } from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

import Link from '@/components/docket-link';
import { useNow } from '@/lib/use-now';

import {
  ElicitationControlView,
  coerceElicitationValue,
  emptyElicitationValue,
  isElicitationAnswered,
  type ElicitationErrorMap,
} from './elicitation-control';
import { useAnswerElicitation, type AnswerRejection } from './elicitation-data';

/** Props for {@link ElicitationCard}. */
export interface ElicitationCardProps {
  /** The question to render. */
  readonly elicitation: ElicitationOut;
  /** The workspace uploads are stored in, when the question lives in one. */
  readonly organizationId?: string | null;
  /** Lift this entry one tonal step — used when arriving from a notification. */
  readonly focused?: boolean;
  /** Extra class names for the root element. */
  readonly className?: string;
}

/**
 * Turn the server's field rejections into a path→sentence map the renderer can read.
 *
 * @remarks
 * Every sentence here is Docket's own, produced by `elicitationFieldMessage` from a Zod issue
 * *code* — no exception text, no provider text, no Problem `detail` ever reaches this map.
 */
function toErrorMap(rejections: readonly AnswerRejection[]): ElicitationErrorMap {
  const map: Record<string, string> = {};
  for (const rejection of rejections) map[rejection.path] = rejection.text;
  return map;
}

/** How long is left before the question stops waiting, in the words a person would use. */
function describeDeadline(expiresAt: string, now: number): string {
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return 'Deadline passed';
  const minutes = Math.round(remaining / 60_000);
  if (minutes < 1) return 'Less than a minute left';
  if (minutes < 60) return `${String(minutes)} min left`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)} hr left`;
  return `${String(Math.round(hours / 24))} days left`;
}

/** The state line of a question that is no longer waiting. */
function settledStateLine(elicitation: ElicitationOut): string {
  if (elicitation.status === 'parked') {
    return elicitation.timeoutPolicy === 'destructive'
      ? 'On hold · cannot be undone, waiting on you'
      : 'On hold · either answer works, waiting on you';
  }
  if (elicitation.status === 'canceled') return 'Withdrawn';
  if (elicitation.resolver === 'athena') {
    return elicitation.autoResolveReason
      ? `Answered for you · ${elicitation.autoResolveReason}`
      : 'Answered for you';
  }
  return 'You answered';
}

/** The state line of a question still waiting: the ask, the deadline, and urgency when it is. */
function pendingStateLine(elicitation: ElicitationOut, now: number): string {
  const parts = ['Waiting on you', describeDeadline(elicitation.expiresAt, now)];
  if (elicitation.timeSensitive) parts.push('Time-sensitive');
  return parts.join(' · ');
}

/** The state dot's fill: solid primary while waiting, error on hold, muted once settled. */
function dotClass(status: ElicitationOut['status']): string {
  if (status === 'pending') return 'bg-primary';
  if (status === 'parked') return 'bg-error';
  return 'bg-on-surface-variant/30';
}

/**
 * Render one answered value as the sentence of the read-only record.
 *
 * @remarks
 * Total over the control grammar for the same reason the renderer is: a shape with no case here
 * would fall through to stringifying a payload at the person, which is the opposite of a record
 * they can read. Labels are resolved back from the spec, so "Operations" is shown rather than
 * `"ops"`, and a file is its own name rather than its attachment id.
 */
function renderAnswer(spec: ElicitationOut['spec'], answer: unknown): string {
  if (answer === null || answer === undefined) return '—';
  switch (spec.kind) {
    case 'confirm':
      return answer === true ? spec.confirmLabel : spec.declineLabel;
    case 'select': {
      const chosen: unknown[] = Array.isArray(answer) ? answer : [answer];
      return chosen
        .map(
          (value) => spec.options.find((option) => option.value === value)?.label ?? String(value),
        )
        .join(', ');
    }
    case 'file': {
      const files: unknown[] = Array.isArray(answer) ? answer : [answer];
      return files
        .map((file) =>
          file && typeof file === 'object' && 'fileName' in file ? String(file.fileName) : 'a file',
        )
        .join(', ');
    }
    case 'form': {
      const record = answer as Record<string, unknown>;
      return spec.fields
        .filter((field) => record[field.key] !== undefined && record[field.key] !== null)
        .map((field) => `${field.label}: ${renderAnswer(field.control, record[field.key])}`)
        .join(' · ');
    }
    case 'list': {
      const items: unknown[] = Array.isArray(answer) ? answer : [];
      return items.length === 0
        ? 'nothing'
        : items.map((item) => renderAnswer(spec.item, item)).join(', ');
    }
    case 'variant': {
      const record = answer as Record<string, unknown>;
      const tagValue = record[spec.discriminator];
      const tag = typeof tagValue === 'string' ? tagValue : '';
      const variant = spec.variants.find((candidate) => candidate.value === tag);
      if (!variant) return tag;
      const details = variant.fields
        .filter((field) => record[field.key] !== undefined && record[field.key] !== null)
        .map((field) => `${field.label}: ${renderAnswer(field.control, record[field.key])}`)
        .join(' · ');
      return details ? `${variant.label} — ${details}` : variant.label;
    }
    case 'text':
    case 'number':
    case 'datetime':
      return typeof answer === 'string' || typeof answer === 'number' ? String(answer) : '—';
  }
}

/** Props for {@link QuestionStateLine}. */
interface QuestionStateLineProps {
  readonly elicitation: ElicitationOut;
  readonly now: number;
}

/** Line 2: where the question stands, then the task it unblocks. */
function QuestionStateLine({ elicitation, now }: QuestionStateLineProps): JSX.Element {
  const state =
    elicitation.status === 'pending'
      ? pendingStateLine(elicitation, now)
      : settledStateLine(elicitation);
  return (
    <p
      data-slot="athena-question-state"
      className="text-on-surface-variant text-body-small -mt-1 flex min-w-0 gap-1"
    >
      <span className="shrink-0">{state} ·</span>
      <Link href={elicitation.task.href} className="hover:text-primary min-w-0 truncate">
        {elicitation.task.title}
      </Link>
    </p>
  );
}

/** Props for {@link QuestionForm}. */
interface QuestionFormProps {
  readonly elicitation: ElicitationOut;
  readonly organizationId: string | null;
  readonly answer: ReturnType<typeof useAnswerElicitation>;
}

/** Line 3 while waiting: the question, its controls, and Send / Clear. */
function QuestionForm({ elicitation, organizationId, answer }: QuestionFormProps): JSX.Element {
  const [value, setValue] = useState<unknown>(() => emptyElicitationValue(elicitation.spec));
  const [errors, setErrors] = useState<ElicitationErrorMap>({});
  const ready = useMemo(
    () => isElicitationAnswered(elicitation.spec, value),
    [elicitation.spec, value],
  );
  const rootError = errors[''];

  const submit = (): void => {
    answer.mutate(
      { id: elicitation.id, value: coerceElicitationValue(elicitation.spec, value) },
      {
        // A rejection keeps the question open and every other field exactly where it was.
        onSuccess: (result) => {
          setErrors(result.ok ? {} : toErrorMap(result.errors));
        },
      },
    );
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !answer.isPending) submit();
      }}
    >
      <p className="text-on-surface text-body-medium">{elicitation.question}</p>
      <ElicitationControlView
        control={elicitation.spec}
        value={value}
        path=""
        errors={errors}
        disabled={answer.isPending}
        {...(organizationId
          ? { uploadTarget: { orgId: organizationId, taskId: elicitation.task.id } }
          : {})}
        onChange={setValue}
      />
      {rootError ? <FieldError>{rootError}</FieldError> : null}
      <ControlGroup controlSize="md">
        <Button type="submit" controlSize="md" disabled={!ready || answer.isPending}>
          {answer.isPending ? 'Sending…' : 'Send'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          controlSize="md"
          disabled={answer.isPending}
          onClick={() => {
            setValue(emptyElicitationValue(elicitation.spec));
            setErrors({});
          }}
        >
          Clear
        </Button>
      </ControlGroup>
    </form>
  );
}

/** Props for {@link QuestionRecord}. */
interface QuestionRecordProps {
  readonly elicitation: ElicitationOut;
}

/** Line 3 once settled: the question, then the answer that was recorded. */
function QuestionRecord({ elicitation }: QuestionRecordProps): JSX.Element {
  const answered = elicitation.status === 'answered' || elicitation.status === 'auto_resolved';
  return (
    <div className="flex flex-col gap-1">
      <p className="text-on-surface-variant text-body-medium">{elicitation.question}</p>
      {answered ? (
        <p data-slot="athena-question-answer" className="text-on-surface text-body-medium">
          {renderAnswer(elicitation.spec, elicitation.answer)}
        </p>
      ) : null}
    </div>
  );
}

/** Render one elicitation as a flat thread entry. */
export function ElicitationCard({
  elicitation: incoming,
  organizationId = null,
  focused = false,
  className,
}: ElicitationCardProps): JSX.Element {
  const answer = useAnswerElicitation();
  // Settle in place the instant the server accepts, rather than waiting for the next read: the
  // record has to appear where the form was, or answering looks like the question vanished.
  const accepted = answer.data?.ok === true ? answer.data.elicitation : null;
  const elicitation = accepted ?? incoming;
  const pending = elicitation.status === 'pending';
  // The deadline is on the state line, so it has to keep being true while the question waits.
  const now = useNow(30_000, { enabled: pending }).getTime();
  const titleId = `elicitation-action-${elicitation.id}`;

  return (
    <article
      data-elicitation={elicitation.id}
      data-elicitation-status={elicitation.status}
      aria-labelledby={titleId}
      className={cn(
        'relative flex w-full max-w-160 flex-col gap-2 pl-6',
        // A landing from a notification lifts the entry one tonal step; never a ring or outline.
        focused && cn(surfaceToneColor('floating'), 'rounded-lg'),
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-slot="athena-question-dot"
        className={cn('absolute top-3 left-2 size-2 rounded-full', dotClass(elicitation.status))}
      />
      <div className="flex min-h-8 items-center gap-2">
        <h3
          id={titleId}
          title={elicitation.actionSummary}
          className="text-on-surface text-title-small min-w-0 flex-1 truncate"
        >
          {elicitation.actionSummary}
        </h3>
        <RelativeTime
          iso={elicitation.createdAt}
          className="text-on-surface-variant text-label-small shrink-0"
        >
          {relativeTime(elicitation.createdAt)}
        </RelativeTime>
      </div>
      <QuestionStateLine elicitation={elicitation} now={now} />
      {pending ? (
        <QuestionForm elicitation={elicitation} organizationId={organizationId} answer={answer} />
      ) : (
        <QuestionRecord elicitation={elicitation} />
      )}
    </article>
  );
}
