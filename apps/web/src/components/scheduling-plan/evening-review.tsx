'use client';

/**
 * The end-of-day review — three steps, all required.
 *
 * @remarks
 * A defined flow rather than a free-text box, because "reflect on your day" as an empty textarea
 * is a box people stop filling in by Thursday. Step one lists every unfinished block and requires
 * a decision on each; step two asks three fixed questions; step three requires tomorrow to be
 * explicitly confirmed. The gate at the top names whatever is still outstanding and opens only
 * when nothing is.
 *
 * Every refusal is server-enforced too (a drop needs a reason, a reschedule needs a date, and
 * confirming tomorrow early is rejected) — this surface makes those rules visible rather than
 * being the only thing that holds them.
 */
import type {
  DayReviewOut,
  ReconcileDisposition,
  ReviewPromptKey,
} from '@docket/planning/scheduling-directive-contract';
import {
  Button,
  ControlGroup,
  Field,
  Input,
  Stack,
  Text,
  Textarea,
  Toolbar,
} from '@docket/ui/primitives';
import { CheckCircle2, CircleDashed } from '@docket/ui/icons';
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';

import { WorkShapeChip } from './work-shape-chip';

/** Props for {@link EveningReview}. */
export interface EveningReviewProps {
  readonly review: DayReviewOut;
  readonly onDispose: (input: {
    key: string;
    disposition: ReconcileDisposition;
    rescheduledTo?: string | null;
    reason?: string | null;
  }) => void;
  readonly onAnswer: (input: { key: ReviewPromptKey; answer: string }) => void;
  readonly onConfirmTomorrow: (acceptedKeys: string[]) => void;
  readonly busy?: boolean;
  /**
   * An ungated panel rendered above step one.
   *
   * @remarks
   * A slot rather than data, and that is the whole design: the review owns three steps and a gate, and
   * must not grow a dependency on whatever surface sits above them. Reading what happened is not a
   * decision, so it stays outside the gate — the step counter and every completion rule are unchanged.
   */
  readonly leadingPanel?: ReactNode;
}

/** Local clock reading. */
function clock(iso: string | null, timezone: string): string {
  if (iso === null) return '';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
}

/**
 * The evening surface.
 *
 * @param props - The review payload and the three step actions.
 * @returns the review.
 */
export function EveningReview(props: EveningReviewProps): JSX.Element {
  const { review } = props;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dropReasons, setDropReasons] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Set<string> | null>(null);
  const acceptedKeys =
    accepted ?? new Set(review.tomorrowProposals.map((proposal) => proposal.key));

  return (
    <Stack gap={6} className="w-full min-w-0">
      <Toolbar
        controlSize="md"
        leading={
          <Stack gap={1} className="min-w-0">
            <Text as="h2" token="headline-small">
              Close out the day
            </Text>
            <Text token="body-small" tone="muted">
              {review.complete
                ? 'Done — the day is closed.'
                : `${String(review.steps.filter((s) => s.complete).length)} of ${String(review.steps.length)} steps done`}
            </Text>
          </Stack>
        }
        trailing={null}
      />

      <Stack gap={2} className="bg-surface-container rounded-xl p-4" data-testid="review-steps">
        {review.steps.map((step) => (
          <div key={step.key} className="flex items-center gap-2">
            {step.complete ? (
              <CheckCircle2 fontSize="small" aria-hidden className="text-primary" />
            ) : (
              <CircleDashed fontSize="small" aria-hidden className="text-on-surface-variant" />
            )}
            <Text token="body-medium">{step.title}</Text>
            {step.outstanding > 0 ? (
              <Text token="label-small" tone="muted" numeric>
                {String(step.outstanding)} left
              </Text>
            ) : null}
          </div>
        ))}
      </Stack>

      {props.leadingPanel === undefined ? null : (
        <div data-testid="review-leading-panel">{props.leadingPanel}</div>
      )}

      {/* Step one — every unfinished item gets a decision. */}
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
                  <Text token="title-small" truncate>
                    {item.title}
                  </Text>
                  {item.shape === null ? null : (
                    <div>
                      <WorkShapeChip shape={item.shape} controlSize="xs" />
                    </div>
                  )}
                </Stack>

                {item.disposition === null ? (
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
                        variant="outline"
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
                      description="A dropped commitment needs an explanation — that is what makes this a review."
                    >
                      <ControlGroup controlSize="sm">
                        <Input
                          value={dropReasons[item.key] ?? ''}
                          placeholder="Why is this not happening?"
                          onChange={(event) => {
                            setDropReasons((current) => ({
                              ...current,
                              [item.key]: event.target.value,
                            }));
                          }}
                        />
                        <Button
                          variant="ghost"
                          disabled={
                            props.busy === true || (dropReasons[item.key] ?? '').trim().length === 0
                          }
                          onClick={() => {
                            props.onDispose({
                              key: item.key,
                              disposition: 'dropped',
                              reason: dropReasons[item.key] ?? '',
                            });
                          }}
                        >
                          Drop
                        </Button>
                      </ControlGroup>
                    </Field>
                  </Stack>
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
            ))}
          </Stack>
        )}
      </Stack>

      {/* Step two — the three fixed questions. */}
      <Stack gap={3}>
        <Text as="h3" token="title-medium">
          Review the day
        </Text>
        <Stack gap={4} data-testid="review-questions">
          {review.answers.map((answer) => (
            <Field key={answer.key} label={answer.prompt}>
              <Stack gap={2}>
                <Textarea
                  value={drafts[answer.key] ?? answer.answer ?? ''}
                  rows={2}
                  onChange={(event) => {
                    setDrafts((current) => ({ ...current, [answer.key]: event.target.value }));
                  }}
                />
                <div>
                  <Button
                    variant="outline"
                    controlSize="sm"
                    disabled={
                      props.busy === true ||
                      (drafts[answer.key] ?? answer.answer ?? '').trim().length === 0
                    }
                    onClick={() => {
                      props.onAnswer({
                        key: answer.key,
                        answer: drafts[answer.key] ?? answer.answer ?? '',
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

      {/* Step three — tomorrow, confirmed explicitly. */}
      <Stack gap={3}>
        <Text as="h3" token="title-medium">
          Tomorrow
        </Text>
        {review.tomorrowProposals.length === 0 ? (
          <Text token="body-medium" tone="muted">
            Nothing is carried into tomorrow yet. Move something forward above, or confirm an empty
            day.
          </Text>
        ) : (
          <Stack gap={2} as="ul" data-testid="tomorrow-proposals">
            {review.tomorrowProposals.map((proposal) => {
              const isAccepted = acceptedKeys.has(proposal.key);
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
                    <Text token="title-small" truncate>
                      {proposal.title}
                    </Text>
                  </Stack>
                  <Button
                    variant={isAccepted ? 'secondary' : 'ghost'}
                    controlSize="sm"
                    aria-pressed={isAccepted}
                    disabled={review.complete}
                    onClick={() => {
                      const next = new Set(acceptedKeys);
                      if (isAccepted) next.delete(proposal.key);
                      else next.add(proposal.key);
                      setAccepted(next);
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
            disabled={props.busy === true || review.complete}
            onClick={() => {
              props.onConfirmTomorrow([...acceptedKeys]);
            }}
          >
            {review.complete ? 'Tomorrow confirmed' : "Confirm tomorrow's agenda"}
          </Button>
        </div>
        {review.gate.outstandingSteps.length > 0 ? (
          <Text token="body-small" tone="muted">
            Confirming is the last step — the earlier ones have to be done first.
          </Text>
        ) : null}
      </Stack>
    </Stack>
  );
}
