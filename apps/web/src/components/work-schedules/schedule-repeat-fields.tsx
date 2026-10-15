'use client';
import type { JSX } from 'react';
import { Field, Input, Surface } from '@docket/ui/primitives';
import { DatePicker } from '@/components/date-picker';
import { RepeatTaskControl } from '@/components/recurrence/repeat-task-control';
import type { ScheduleAuthoringDraft } from './schedule-draft';

/** Existing recurrence controls inside the schedule's freely revisitable Repeat section. */
export function ScheduleRepeatFields({
  draft,
  today,
  minimumDate,
  disabled,
  onChange,
  editing,
}: {
  readonly draft: ScheduleAuthoringDraft;
  readonly today: string;
  readonly minimumDate: string;
  readonly disabled: boolean;
  readonly onChange: (draft: ScheduleAuthoringDraft) => void;
  readonly editing: boolean;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h2 tabIndex={-1} className="text-headline-small outline-none">
          Give it a rhythm
        </h2>
        <p className="text-body-large text-on-surface-variant mt-2">
          Choose when new work should arrive.
        </p>
      </div>
      <ScheduleCadence {...{ draft, today, minimumDate, disabled, onChange, editing }} />
      <Field
        label="Timezone"
        description="Dates and title tokens use this timezone, including across daylight-saving changes."
      >
        <Input
          aria-label="Schedule timezone"
          value={draft.timezone}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...draft, timezone: event.target.value });
          }}
        />
      </Field>
      {editing || draft.repeat.kind !== 'calendar' ? (
        <Field
          label={editing ? 'Apply to future runs from' : 'Available from'}
          description={
            editing
              ? `Changes can begin on ${minimumDate} or later. Already-created work keeps its original details.`
              : undefined
          }
        >
          <DatePicker
            value={draft.effectiveFrom}
            min={minimumDate}
            today={today}
            onChange={(value) => {
              if (value) onChange({ ...draft, effectiveFrom: value });
            }}
            ariaLabel="Schedule effective date"
            placeholder="Choose a date"
            disabled={disabled}
            triggerVariant="secondary"
          />
        </Field>
      ) : null}
    </div>
  );
}

function ScheduleCadence({
  draft,
  today,
  disabled,
  onChange,
  editing,
}: Parameters<typeof ScheduleRepeatFields>[0]): JSX.Element {
  return (
    <Surface tone="well" shape="medium" className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
      {draft.retainedTrigger ? (
        <p className="text-body-large">
          This schedule runs when its saved event matches. Changing work keeps that event rule.
        </p>
      ) : (
        <RepeatTaskControl
          presentation="inline"
          workNoun={draft.kind}
          value={draft.repeat}
          today={today}
          timezone={draft.timezone}
          disabled={disabled}
          onChange={(repeat) => {
            onChange({
              ...draft,
              repeat,
              effectiveFrom:
                !editing && repeat.kind === 'calendar'
                  ? repeat.schedule.startDate
                  : draft.effectiveFrom,
            });
          }}
        />
      )}
      {draft.repeat.kind === 'none' && !draft.retainedTrigger ? (
        <p className="text-body-medium text-on-surface-variant">
          Run this routine when you need it. No work will be created automatically.
        </p>
      ) : null}
    </Surface>
  );
}
