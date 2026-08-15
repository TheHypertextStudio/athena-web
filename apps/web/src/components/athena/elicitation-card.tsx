'use client';

/**
 * One elicitation, as a card inside the conversation.
 *
 * @remarks
 * The card leads with the **action** — "Post the sprint update to the Acme project channel" — and
 * puts the question underneath it, because the thing being authorized is what a person needs to
 * decide, and a bare question ("Which channel?") does not tell them what happens next.
 *
 * Three states, one component: waiting (the controls, submit, cancel, and the deadline), settled
 * (a read-only record of what was answered and by whom), and parked (Athena declined to choose and
 * says so). A settled card stays in place rather than disappearing — the conversation is a record,
 * and a question that vanishes once answered takes its own context with it.
 */
import type { ElicitationOut } from '@docket/athena/elicitation-api';
import { AlarmClock, CircleAlert, HelpCircle, ListChecks, Sparkles } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Badge, Button, Chip, ControlGroup, Text } from '@docket/ui/primitives';
import Link from 'next/link';

import { useNow } from '@/lib/use-now';
import { type JSX, useMemo, useState } from 'react';

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
  /** Scroll this card into view and focus it — used when arriving from a notification. */
  readonly focused?: boolean;
  /** Extra class names for the root element. */
  readonly className?: string;
}

/**
 * Turn the server's field rejections into a path→sentence map the renderer can read.
 *
 * @remarks
 * Every sentence here is Docket's own, produced by `elicitationFieldMessage` from a Zod issue
 * *code* — no exception text, no provider text, no Problem `detail` ever reaches this map. The
 * local name is `rejection` rather than `error` for exactly that reason: this is validation
 * feedback about a field, not a failure being reported.
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

/** The sentence describing what a settled question ended up as. */
function describeSettlement(elicitation: ElicitationOut): string {
  if (elicitation.status === 'parked') {
    return elicitation.timeoutPolicy === 'destructive'
      ? 'Athena did not choose — this cannot be undone. Still waiting on you.'
      : 'Athena did not choose — either answer was defensible. Still waiting on you.';
  }
  if (elicitation.status === 'canceled') return 'This question was withdrawn.';
  if (elicitation.resolver === 'athena') {
    return elicitation.autoResolveReason
      ? `Athena answered — ${elicitation.autoResolveReason}`
      : 'Athena answered on your behalf.';
  }
  return 'You answered.';
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

/** Render one elicitation as a card. */
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
  const [value, setValue] = useState<unknown>(() => emptyElicitationValue(incoming.spec));
  const [errors, setErrors] = useState<ElicitationErrorMap>({});
  const [failure, setFailure] = useState<string | null>(null);
  // The deadline is on the card, so it has to keep being true while the card is awaiting an answer.
  const now = useNow(30_000, { enabled: pending }).getTime();

  const ready = useMemo(
    () => isElicitationAnswered(elicitation.spec, value),
    [elicitation.spec, value],
  );
  const rootError = errors[''];

  const submit = (): void => {
    setFailure(null);
    answer.mutate(
      { id: elicitation.id, value: coerceElicitationValue(elicitation.spec, value) },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setErrors({});
            return;
          }
          // The question stays open and every other field the person typed stays exactly where it
          // was — that is what makes a rejection recoverable rather than a restart.
          setErrors(toErrorMap(result.errors));
        },
        onError: () => {
          setFailure('Athena could not record that answer. Try again.');
        },
      },
    );
  };

  return (
    <article
      data-elicitation={elicitation.id}
      data-elicitation-status={elicitation.status}
      aria-labelledby={`elicitation-action-${elicitation.id}`}
      className={cn(
        'bg-surface-container flex flex-col gap-4 rounded-xl px-4 py-4',
        focused && 'ring-primary ring-2',
        className,
      )}
    >
      <header className="flex flex-col gap-2">
        <ControlGroup controlSize="xs" wrap>
          <Chip
            variant="assist"
            tone="tonal"
            icon={<Sparkles aria-hidden="true" />}
            asChild
            aria-disabled="true"
          >
            <span>Athena needs a decision</span>
          </Chip>
          {pending ? (
            <Chip variant="assist" tone="outlined" icon={<AlarmClock aria-hidden="true" />} asChild>
              <span>{describeDeadline(elicitation.expiresAt, now)}</span>
            </Chip>
          ) : (
            <Badge variant="secondary">{settlementLabel(elicitation)}</Badge>
          )}
          {elicitation.timeSensitive && pending ? (
            <Badge variant="destructive">Time-sensitive</Badge>
          ) : null}
        </ControlGroup>

        {/* The action, first and largest: this is what answering authorizes. */}
        <Text
          as="h3"
          id={`elicitation-action-${elicitation.id}`}
          token="title-medium"
          className="text-balance"
        >
          {elicitation.actionSummary}
        </Text>
        <div className="flex items-start gap-2">
          <HelpCircle
            aria-hidden="true"
            className="text-on-surface-variant mt-0.5 size-4 shrink-0"
          />
          <Text token="body-medium" tone="muted">
            {elicitation.question}
          </Text>
        </div>
        <Link
          href={elicitation.task.href}
          className="text-on-surface-variant hover:text-primary flex w-full min-w-0 items-center gap-1.5"
        >
          <ListChecks aria-hidden="true" className="size-4 shrink-0" />
          <Text token="label-medium" truncate className="min-w-0">
            {elicitation.task.title}
          </Text>
        </Link>
      </header>

      {pending ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !answer.isPending) submit();
          }}
        >
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

          {rootError ? (
            <Text token="body-small" tone="error" role="alert">
              {rootError}
            </Text>
          ) : null}
          {failure ? (
            <Text token="body-small" tone="error" role="alert">
              {failure}
            </Text>
          ) : null}

          <ControlGroup controlSize="lg" wrap>
            <Button type="submit" disabled={!ready || answer.isPending}>
              {answer.isPending ? 'Sending…' : 'Send to Athena'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={answer.isPending}
              onClick={() => {
                setValue(emptyElicitationValue(elicitation.spec));
                setErrors({});
                setFailure(null);
              }}
            >
              Clear
            </Button>
          </ControlGroup>
        </form>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            {elicitation.status === 'parked' ? (
              <CircleAlert aria-hidden="true" className="text-error mt-0.5 size-4 shrink-0" />
            ) : null}
            <Text token="body-medium">{describeSettlement(elicitation)}</Text>
          </div>
          {elicitation.status === 'answered' || elicitation.status === 'auto_resolved' ? (
            <Text token="label-large">{renderAnswer(elicitation.spec, elicitation.answer)}</Text>
          ) : null}
        </div>
      )}
    </article>
  );
}

/** The badge word for a settled question. */
function settlementLabel(elicitation: ElicitationOut): string {
  switch (elicitation.status) {
    case 'answered':
      return 'Answered';
    case 'auto_resolved':
      return 'Answered by Athena';
    case 'parked':
      return 'On hold';
    case 'canceled':
      return 'Withdrawn';
    /* v8 ignore next 2 -- @preserve a pending question never reaches this branch */
    default:
      return 'Waiting';
  }
}
