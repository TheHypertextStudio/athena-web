'use client';
import type {
  DayReviewOut,
  ReconcileDisposition,
  ReviewPromptKey,
  ReviewStepKey,
} from '@docket/planning/scheduling-directive-contract';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ControlGroup,
  Stack,
  Text,
} from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { ReconcilePanel, ReflectionPanel, TomorrowPanel } from './evening-review-panels';

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
   * Optional activity context, revealed separately from the current decision.
   *
   * @remarks
   * A slot rather than data, and that is the whole design: the review owns three steps and a gate, and
   * must not grow a dependency on whatever surface sits above them. Reading what happened is not a
   * decision, so it stays outside the gate — the step counter and every completion rule are unchanged.
   */
  readonly leadingPanel?: ReactNode;
}

/** Guide the evening through one revisitable decision at a time, preserving the server gate. */
export function EveningReview(props: EveningReviewProps): JSX.Element {
  const { review } = props;
  const [step, setStep] = useState<ReviewStepKey>(
    () => review.steps.find((item) => !item.complete)?.key ?? 'prepare_tomorrow',
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dropReasons, setDropReasons] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Set<string> | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const acceptedKeys =
    accepted ?? new Set(review.tomorrowProposals.map((proposal) => proposal.key));
  const stepComplete = review.steps.find((item) => item.key === step)?.complete === true;
  const navigate = (next: ReviewStepKey): void => {
    setStep(next);
    panel.current?.focus();
    panel.current?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <Stack gap={4} className="w-full min-w-0">
      <Stack gap={1}>
        <Text as="h2" token="title-large" className="sm:text-headline-small">
          Close out the day
        </Text>
        <Text token="body-small" tone="muted">
          {review.complete
            ? 'Done — the day is closed.'
            : `${String(review.steps.filter((item) => item.complete).length)} of 3 steps done`}
        </Text>
      </Stack>
      <ControlGroup
        controlSize="sm"
        wrap
        data-testid="review-steps"
        aria-label="Evening review steps"
      >
        {(
          [
            { key: 'reconcile', label: 'Unfinished work' },
            { key: 'reflect', label: 'Reflect' },
            { key: 'prepare_tomorrow', label: 'Tomorrow' },
          ] as const
        ).map((item, index) => (
          <Button
            key={item.key}
            variant={step === item.key ? 'secondary' : 'ghost'}
            aria-current={step === item.key ? 'step' : undefined}
            onClick={() => {
              navigate(item.key);
            }}
          >
            <span aria-hidden>{index + 1}.</span> {item.label}
          </Button>
        ))}
      </ControlGroup>
      <div
        ref={panel}
        tabIndex={-1}
        className="min-w-0 outline-none"
        aria-label="Current evening step"
        aria-busy={props.busy === true}
      >
        {
          {
            reconcile: (
              <ReconcilePanel
                {...props}
                dropReasons={dropReasons}
                setDropReasons={setDropReasons}
              />
            ),
            reflect: <ReflectionPanel {...props} drafts={drafts} setDrafts={setDrafts} />,
            prepare_tomorrow: (
              <TomorrowPanel {...props} acceptedKeys={acceptedKeys} setAccepted={setAccepted} />
            ),
          }[step]
        }
      </div>
      {step === 'prepare_tomorrow' ? null : (
        <Stack gap={2}>
          <div>
            <Button
              disabled={!stepComplete || props.busy === true}
              onClick={() => {
                navigate(step === 'reconcile' ? 'reflect' : 'prepare_tomorrow');
              }}
            >
              {step === 'reconcile' ? 'Review the day' : 'Prepare tomorrow'}
            </Button>
          </div>
          {stepComplete ? null : (
            <Text token="body-small" tone="muted">
              {step === 'reconcile'
                ? 'Choose what happens to each unfinished item.'
                : 'Save your answers to continue.'}
            </Text>
          )}
        </Stack>
      )}
      {props.leadingPanel === undefined ? null : (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              Activity from today
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="pt-3" data-testid="review-leading-panel">
              {props.leadingPanel}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Stack>
  );
}
