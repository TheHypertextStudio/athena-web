'use client';

/**
 * The morning agenda walk-through.
 *
 * @remarks
 * Not a static list. The day is walked one block at a time, and each block gets a decision —
 * keep it, move it out of today, or drop it — before the review can be marked done. That is the
 * difference between "here is your day" and "you have been through your day", and only the
 * second is a signal anything downstream can act on.
 *
 * The gate is stated plainly at the top: what is still outstanding, and what releases it. The
 * copy never says what holding the gate should *cost* — that is entirely the consuming client's
 * decision, and Docket does not have that vocabulary.
 */
import type { DayStartOut, DirectiveOut } from '@docket/types';
import { Button, ControlGroup, Separator, Stack, Text, Toolbar } from '@docket/ui/primitives';
import { CheckCircle2, ScheduleOutlined } from '@docket/ui/icons';
import type { JSX } from 'react';
import { useState } from 'react';

import { WorkShapeChip } from './work-shape-chip';

/** A person's decision about one block during the morning walk-through. */
type MorningDecision = 'keep' | 'defer' | 'drop';

/** Application-owned copy for each posture. Never a server sentence, never a model's words. */
const POSTURE_HEADLINE: Readonly<Record<DirectiveOut['posture'], string>> = {
  on_track: 'The day is on track',
  attention_needed: 'One thing needs attention',
  intervention_recommended: 'The day needs re-cutting',
};

/** Application-owned copy for each outstanding gate step. */
const STEP_COPY: Readonly<Record<string, string>> = {
  agenda_reviewed: 'Walk through today and decide on each block',
  day_reconciled: 'Decide what happens to unfinished work',
  day_reflected: 'Answer the three review questions',
  tomorrow_confirmed: "Confirm tomorrow's agenda",
};

/** Local clock reading in the day's own timezone. */
function clock(iso: string | null, timezone: string): string {
  if (iso === null) return 'Any time';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
}

/** Props for {@link DayStartReview}. */
export interface DayStartReviewProps {
  readonly dayStart: DayStartOut;
  readonly directive: DirectiveOut | undefined;
  readonly onAcknowledge: () => void;
  readonly acknowledging: boolean;
  /** Invoked when the person asks for the rest of the day to be re-cut. */
  readonly onReorganize?: () => void;
  readonly reorganizing?: boolean;
}

/**
 * The start-of-day surface.
 *
 * @param props - The handshake payload, the directive, and the release action.
 * @returns the review.
 */
export function DayStartReview(props: DayStartReviewProps): JSX.Element {
  const { dayStart } = props;
  const [decisions, setDecisions] = useState<Record<string, MorningDecision>>({});
  const decided = dayStart.agenda.filter(
    (item) => decisions[item.calendarItemId ?? item.title] !== undefined,
  ).length;
  const allDecided = dayStart.agenda.length > 0 && decided === dayStart.agenda.length;
  const released = dayStart.acknowledgedAt !== null;

  if (!dayStart.ready) {
    return (
      <Stack gap={3} className="bg-surface-container-low rounded-xl p-6">
        <Text as="h2" token="headline-small">
          Today is not planned yet
        </Text>
        <Text token="body-medium" tone="muted">
          {dayStart.readiness === 'not_generated'
            ? 'No planning run covers today. Plan the week and the agenda will be here.'
            : 'The week was planned, but nothing landed on today.'}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap={6} className="w-full min-w-0">
      <Toolbar
        controlSize="md"
        leading={
          <Stack gap={1} className="min-w-0">
            <Text as="h2" token="headline-small">
              Walk through today
            </Text>
            <Text token="body-small" tone="muted">
              {released
                ? `Reviewed at ${clock(dayStart.acknowledgedAt, dayStart.timezone)}`
                : `${String(decided)} of ${String(dayStart.agenda.length)} decided`}
            </Text>
          </Stack>
        }
        trailing={
          <ControlGroup controlSize="md">
            {props.onReorganize === undefined ? null : (
              <Button
                variant="outline"
                onClick={props.onReorganize}
                disabled={props.reorganizing === true}
              >
                {props.reorganizing === true ? 'Re-cutting…' : 'Re-cut the rest of today'}
              </Button>
            )}
            <Button
              onClick={props.onAcknowledge}
              disabled={released || !allDecided || props.acknowledging}
            >
              {released ? 'Reviewed' : props.acknowledging ? 'Saving…' : "I've been through today"}
            </Button>
          </ControlGroup>
        }
      />

      <GateNotice gate={dayStart.gate} directive={props.directive} />

      <Stack gap={2} as="ol" data-testid="morning-agenda">
        {dayStart.agenda.map((item) => {
          const key = item.calendarItemId ?? item.title;
          const decision = decisions[key];
          return (
            <li
              key={key}
              className="bg-surface-container-low flex min-w-0 flex-col gap-3 rounded-xl px-4 py-3 @2xl:flex-row @2xl:items-center @2xl:justify-between"
              data-testid="morning-agenda-item"
              data-decision={decision ?? 'undecided'}
            >
              <Stack gap={1} className="min-w-0">
                <div className="text-on-surface-variant flex items-center gap-1">
                  <ScheduleOutlined fontSize="inherit" aria-hidden />
                  <Text token="body-small" tone="muted" numeric>
                    {clock(item.startsAt, dayStart.timezone)} –{' '}
                    {clock(item.endsAt, dayStart.timezone)}
                  </Text>
                </div>
                <Text token="title-small" truncate>
                  {item.title}
                </Text>
                {item.shape === null ? null : (
                  <div>
                    <WorkShapeChip shape={item.shape} controlSize="xs" />
                  </div>
                )}
              </Stack>
              <ControlGroup controlSize="sm" className="shrink-0">
                {(['keep', 'defer', 'drop'] as const).map((choice) => (
                  <Button
                    key={choice}
                    variant={decision === choice ? 'secondary' : 'ghost'}
                    aria-pressed={decision === choice}
                    disabled={released}
                    onClick={() => {
                      setDecisions((current) => ({ ...current, [key]: choice }));
                    }}
                  >
                    {choice === 'keep' ? 'Keep' : choice === 'defer' ? 'Move out' : 'Drop'}
                  </Button>
                ))}
              </ControlGroup>
            </li>
          );
        })}
      </Stack>
    </Stack>
  );
}

/** What the day is waiting on, and how it is going — stated as a condition, never a command. */
function GateNotice(props: {
  readonly gate: DayStartOut['gate'];
  readonly directive: DirectiveOut | undefined;
}): JSX.Element {
  const outstanding = props.gate.outstandingSteps;
  return (
    <Stack gap={3} className="bg-surface-container rounded-xl p-4">
      <div className="flex items-center gap-2">
        {props.gate.state === 'open' ? (
          <CheckCircle2 fontSize="small" aria-hidden className="text-primary" />
        ) : (
          <ScheduleOutlined fontSize="small" aria-hidden className="text-on-surface-variant" />
        )}
        <Text token="title-small">
          {props.gate.state === 'open' ? "You've been through today" : 'Today is waiting on you'}
        </Text>
      </div>
      {outstanding.length > 0 ? (
        <Stack gap={1} as="ul">
          {outstanding.map((step) => (
            <li key={step}>
              <Text token="body-small" tone="muted">
                {STEP_COPY[step] ?? step}
              </Text>
            </li>
          ))}
        </Stack>
      ) : null}
      {props.directive === undefined ? null : (
        <>
          <Separator />
          <Stack gap={1}>
            <Text token="label-large">{POSTURE_HEADLINE[props.directive.posture]}</Text>
            <Text token="body-small" tone="muted">
              {props.directive.reason}
            </Text>
            {props.directive.recommendedAction === null ? null : (
              <Text token="body-small">
                Worth your full attention right now: {props.directive.recommendedAction.title}
              </Text>
            )}
          </Stack>
        </>
      )}
    </Stack>
  );
}
