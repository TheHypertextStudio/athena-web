'use client';

/**
 * The morning agenda walk-through: propose, defer, confirm.
 *
 * @remarks
 * Not a static list. Docket **proposes** the day one block at a time; the person keeps each block
 * or **defers** it out of today; only once every proposal has an answer is there anything to
 * **confirm**. That is the difference between "here is your day" and "you have been through your
 * day", and only the second is a signal anything downstream can act on.
 *
 * **The decisions live on the server.** They were local component state until they had somewhere
 * to go, which meant a deferral moved nothing and a reload lost the walk-through — a review whose
 * decisions cost the day nothing is theatre. Each answer is a write, and a deferral moves the
 * block for real; `proposals` comes back from the same read that produces the agenda.
 *
 * The gate is stated plainly at the top: what is still outstanding, and what releases it. The
 * copy never says what holding the gate should *cost* — that is entirely the consuming client's
 * decision, and Docket does not have that vocabulary.
 */
import type {
  DayStartOut,
  DirectiveOut,
  MorningProposalOut,
} from '@docket/planning/scheduling-directive-contract';
import { Button, ControlGroup, Separator, Stack, Text, Toolbar } from '@docket/ui/primitives';
import { CheckCircle2, ScheduleOutlined } from '@docket/ui/icons';
import type { JSX } from 'react';

import { WorkShapeChip } from './work-shape-chip';

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
  /** Invoked when the person answers one proposal. */
  readonly onDecide?: (input: { key: string; decision: 'keep' | 'defer' }) => void;
  readonly deciding?: boolean;
  /** Invoked when the person asks for the rest of the day to be re-cut. */
  readonly onReorganize?: () => void;
  readonly reorganizing?: boolean;
}

/**
 * The start-of-day surface.
 *
 * @param props - The handshake payload, the directive, and the review's actions.
 * @returns the review.
 */
export function DayStartReview(props: DayStartReviewProps): JSX.Element {
  const { dayStart } = props;
  const decided = dayStart.proposals.length - dayStart.confirm.outstanding;
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
                : `${String(decided)} of ${String(dayStart.proposals.length)} decided`}
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
              disabled={released || !dayStart.confirm.available || props.acknowledging}
            >
              {released ? 'Reviewed' : props.acknowledging ? 'Saving…' : "I've been through today"}
            </Button>
          </ControlGroup>
        }
      />

      <GateNotice gate={dayStart.gate} directive={props.directive} />

      <Stack gap={2} as="ol" data-testid="morning-agenda">
        {dayStart.proposals.map((proposal) => (
          <ProposalRow
            key={proposal.key}
            proposal={proposal}
            timezone={dayStart.timezone}
            locked={released || props.deciding === true}
            {...(props.onDecide ? { onDecide: props.onDecide } : {})}
          />
        ))}
      </Stack>
    </Stack>
  );
}

/** One proposed block and the two answers it takes. */
function ProposalRow(props: {
  readonly proposal: MorningProposalOut;
  readonly timezone: string;
  readonly locked: boolean;
  readonly onDecide?: (input: { key: string; decision: 'keep' | 'defer' }) => void;
}): JSX.Element {
  const { proposal } = props;
  const choices = (['keep', 'defer'] as const).filter(
    // A block Docket did not place is offered for review but not for deferral — moving it would
    // be Docket editing someone else's diary, and an enabled button that 422s is worse than none.
    (choice) => choice === 'keep' || proposal.deferable,
  );
  return (
    <li
      className="bg-surface-container-low flex min-w-0 flex-col gap-3 rounded-xl px-4 py-3 @2xl:flex-row @2xl:items-center @2xl:justify-between"
      data-testid="morning-agenda-item"
      data-decision={proposal.decision}
    >
      <Stack gap={1} className="min-w-0">
        <div className="text-on-surface-variant flex items-center gap-1">
          <ScheduleOutlined fontSize="inherit" aria-hidden />
          <Text token="body-small" tone="muted" numeric>
            {clock(proposal.startsAt, props.timezone)} – {clock(proposal.endsAt, props.timezone)}
          </Text>
        </div>
        <Text token="title-small" truncate>
          {proposal.title}
        </Text>
        {proposal.shape === null ? null : (
          <div>
            <WorkShapeChip shape={proposal.shape} controlSize="xs" />
          </div>
        )}
      </Stack>
      <ControlGroup controlSize="sm" className="shrink-0">
        {choices.map((choice) => {
          const chosen =
            (choice === 'keep' && proposal.decision === 'kept') ||
            (choice === 'defer' && proposal.decision === 'deferred');
          return (
            <Button
              key={choice}
              variant={chosen ? 'secondary' : 'ghost'}
              aria-pressed={chosen}
              disabled={props.locked || props.onDecide === undefined}
              onClick={() => {
                props.onDecide?.({ key: proposal.key, decision: choice });
              }}
            >
              {choice === 'keep' ? 'Keep' : 'Move out'}
            </Button>
          );
        })}
      </ControlGroup>
    </li>
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
