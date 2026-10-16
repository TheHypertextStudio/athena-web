'use client';
import type { JSX, Dispatch, SetStateAction } from 'react';
import { Button, ControlGroup, Field, Input, Stack, Text, Textarea } from '@docket/ui/primitives';
import type { EveningReviewProps } from './evening-review';
import { WorkShapeChip } from './work-shape-chip';

function clock(iso: string | null, timezone: string): string {
  if (iso === null) return '';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
}

/** Resolve each unfinished commitment without losing its explanation. */
export function ReconcilePanel(
  props: EveningReviewProps & {
    readonly dropReasons: Record<string, string>;
    readonly setDropReasons: Dispatch<SetStateAction<Record<string, string>>>;
  },
): JSX.Element {
  const { review } = props;
  return (
    <Stack gap={3}>
      <Text as="h3" token="title-medium">
        Unfinished work
      </Text>
      {review.items.length === 0 ? (
        <Text token="body-medium" tone="muted">
          Nothing was left over today.
        </Text>
      ) : (
        <Stack gap={2} as="ul" data-testid="reconcile-list">
          {review.items.map((item) => (
            <UnfinishedItem key={item.key} {...props} item={item} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** Save the required reflections, retaining local edits across steps. */
export function ReflectionPanel(
  props: EveningReviewProps & {
    readonly drafts: Record<string, string>;
    readonly setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  },
): JSX.Element {
  const { review } = props;
  return (
    <Stack gap={3}>
      <Text as="h3" token="title-medium">
        Review the day
      </Text>
      <Stack gap={4} data-testid="review-questions">
        {review.answers.map((answer) => (
          <Field key={answer.key} label={answer.prompt}>
            <Stack gap={2}>
              <Textarea
                value={props.drafts[answer.key] ?? answer.answer ?? ''}
                rows={2}
                onChange={(event) => {
                  props.setDrafts((current) => ({ ...current, [answer.key]: event.target.value }));
                }}
              />
              <div>
                <Button
                  variant="secondary"
                  controlSize="sm"
                  disabled={
                    props.busy === true ||
                    (props.drafts[answer.key] ?? answer.answer ?? '').trim().length === 0
                  }
                  onClick={() => {
                    props.onAnswer({
                      key: answer.key,
                      answer: props.drafts[answer.key] ?? answer.answer ?? '',
                    });
                  }}
                >
                  {answer.answer === null ? 'Save' : 'Update'}
                </Button>
              </div>
            </Stack>
          </Field>
        ))}
      </Stack>
    </Stack>
  );
}

function confirmationLabel(busy: boolean, complete: boolean): string {
  if (busy) return 'Saving…';
  return complete ? 'Tomorrow confirmed' : "Confirm tomorrow's agenda";
}

/** Review carried work and explicitly confirm after prior decisions are saved. */
export function TomorrowPanel(
  props: EveningReviewProps & {
    readonly acceptedKeys: Set<string>;
    readonly setAccepted: Dispatch<SetStateAction<Set<string> | null>>;
  },
): JSX.Element {
  const { review } = props;
  return (
    <Stack gap={3}>
      <Text as="h3" token="title-medium">
        Tomorrow
      </Text>
      {review.tomorrowProposals.length === 0 ? (
        <Text token="body-medium" tone="muted">
          Nothing is carried into tomorrow yet. Move something forward in Unfinished work, or
          confirm an empty day.
        </Text>
      ) : (
        <Stack gap={2} as="ul" data-testid="tomorrow-proposals">
          {review.tomorrowProposals.map((proposal) => {
            const isAccepted = props.acceptedKeys.has(proposal.key);
            return (
              <li
                key={proposal.key}
                className="bg-surface-container-low flex min-w-0 items-center justify-between gap-3 rounded-xl px-4 py-3"
              >
                <Stack gap={1} className="min-w-0">
                  <Text token="body-small" tone="muted" numeric>
                    {clock(proposal.startsAt, review.timezone)} –{' '}
                    {clock(proposal.endsAt, review.timezone)}
                  </Text>
                  <Text token="title-small" className="break-words">
                    {proposal.title}
                  </Text>
                </Stack>
                <Button
                  variant={isAccepted ? 'secondary' : 'ghost'}
                  controlSize="sm"
                  aria-pressed={isAccepted}
                  disabled={review.complete}
                  onClick={() => {
                    const next = new Set(props.acceptedKeys);
                    if (isAccepted) next.delete(proposal.key);
                    else next.add(proposal.key);
                    props.setAccepted(next);
                  }}
                >
                  {isAccepted ? 'Keeping' : 'Skipped'}
                </Button>
              </li>
            );
          })}
        </Stack>
      )}
      <div>
        <Button
          disabled={
            props.busy === true ||
            review.complete ||
            !review.steps
              .filter((step) => step.key !== 'prepare_tomorrow')
              .every((step) => step.complete)
          }
          onClick={() => {
            props.onConfirmTomorrow([...props.acceptedKeys]);
          }}
        >
          {confirmationLabel(props.busy === true, review.complete)}
        </Button>
      </div>
      {review.steps.some((step) => step.key !== 'prepare_tomorrow' && !step.complete) ? (
        <Text token="body-small" tone="muted">
          Finish your work decisions and save your reflections before confirming tomorrow.
        </Text>
      ) : null}
    </Stack>
  );
}

function UnfinishedItem(
  props: EveningReviewProps & {
    readonly dropReasons: Record<string, string>;
    readonly setDropReasons: Dispatch<SetStateAction<Record<string, string>>>;
    readonly item: EveningReviewProps['review']['items'][number];
  },
): JSX.Element {
  const { review, item } = props;
  return (
    <li
      key={item.key}
      className="bg-surface-container-low flex min-w-0 flex-col gap-3 rounded-xl px-4 py-3"
      data-testid="reconcile-item"
      data-disposition={item.disposition ?? 'undecided'}
    >
      <Stack gap={1} className="min-w-0">
        <Text token="body-small" tone="muted" numeric>
          {clock(item.startsAt, review.timezone)}
        </Text>
        <Text token="title-small" className="break-words">
          {item.title}
        </Text>
        {item.shape === null ? null : (
          <div>
            <WorkShapeChip shape={item.shape} controlSize="xs" />
          </div>
        )}
      </Stack>

      {item.disposition === null ? (
        <UnfinishedChoices {...props} item={item} />
      ) : (
        <Text token="body-small" tone="muted">
          {item.disposition === 'completed'
            ? 'Marked done.'
            : item.disposition === 'rescheduled'
              ? `Moved to ${item.rescheduledTo ?? 'another day'}.`
              : `Dropped — ${item.reason ?? ''}`}
        </Text>
      )}
    </li>
  );
}

function UnfinishedChoices(
  props: EveningReviewProps & {
    readonly dropReasons: Record<string, string>;
    readonly setDropReasons: Dispatch<SetStateAction<Record<string, string>>>;
    readonly item: EveningReviewProps['review']['items'][number];
  },
): JSX.Element {
  const { review, item } = props;
  return (
    <Stack gap={2}>
      <ControlGroup controlSize="sm" wrap>
        <Button
          variant="secondary"
          disabled={props.busy === true}
          onClick={() => {
            props.onDispose({ key: item.key, disposition: 'completed' });
          }}
        >
          Actually done
        </Button>
        <Button
          variant="secondary"
          disabled={props.busy === true}
          onClick={() => {
            props.onDispose({
              key: item.key,
              disposition: 'rescheduled',
              rescheduledTo: review.tomorrowDate,
            });
          }}
        >
          Move to tomorrow
        </Button>
      </ControlGroup>
      <Field
        label="Or drop it, with a reason"
        description="Keep a note of why this no longer needs doing."
      >
        <ControlGroup controlSize="sm">
          <Input
            value={props.dropReasons[item.key] ?? ''}
            placeholder="Why is this not happening?"
            onChange={(event) => {
              props.setDropReasons((current) => ({
                ...current,
                [item.key]: event.target.value,
              }));
            }}
          />
          <Button
            variant="ghost"
            disabled={
              props.busy === true || (props.dropReasons[item.key] ?? '').trim().length === 0
            }
            onClick={() => {
              props.onDispose({
                key: item.key,
                disposition: 'dropped',
                reason: props.dropReasons[item.key] ?? '',
              });
            }}
          >
            Drop
          </Button>
        </ControlGroup>
      </Field>
    </Stack>
  );
}
