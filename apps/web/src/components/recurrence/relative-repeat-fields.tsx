'use client';
import { useState, type JSX } from 'react';
import type { RelativeCalendarRecurrenceSchedule } from '@docket/work/work-schedule-defaults';
import { useVocabulary } from '@docket/ui/hooks';
import { Field, Input, Select } from '@docket/ui/primitives';
import { MonthlyRepeatPattern, YearlyRepeatPattern } from './repeat-calendar-pattern';
import { RepeatWeekdaySelection } from './repeat-weekday-selection';
import { relativeCadence } from './relative-repeat-draft';

/** Reusable calendar rhythm anchored to Program creation with no literal location facts. */
export function RelativeRepeatFields({
  value,
  onChange,
  disabled,
}: {
  readonly value: RelativeCalendarRecurrenceSchedule;
  readonly onChange: (value: RelativeCalendarRecurrenceSchedule) => void;
  readonly disabled: boolean;
}): JSX.Element {
  const program = useVocabulary('program');
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Repeats">
          <Select
            aria-label="Default schedule cadence"
            value={value.kind}
            onChange={(event) => {
              onChange(
                relativeCadence(
                  event.target.value as RelativeCalendarRecurrenceSchedule['kind'],
                  value,
                ),
              );
            }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </Select>
        </Field>
        <Field label="Every">
          <Input
            aria-label="Default schedule interval"
            type="number"
            min={1}
            value={value.interval}
            onChange={(event) => {
              onChange({ ...value, interval: Number(event.target.value) });
            }}
          />
        </Field>
      </div>
      {value.kind === 'weekly' ? (
        <RepeatWeekdaySelection
          value={value.weekdays}
          onChange={(weekdays) => {
            onChange({ ...value, weekdays });
          }}
        />
      ) : null}
      {value.kind === 'monthly' ? (
        <MonthlyRepeatPattern
          value={value.pattern}
          onChange={(pattern) => {
            onChange({ ...value, pattern });
          }}
        />
      ) : null}
      {value.kind === 'yearly' ? (
        <YearlyRepeatPattern
          value={value}
          onChange={(fields) => {
            onChange({ ...value, ...fields });
          }}
        />
      ) : null}
      <RelativeStart {...{ value, onChange }} />
      <RelativeEnd {...{ value, onChange }} />
      <p className="text-body-small text-on-surface-variant">
        Each {program} supplies its own creation date and timezone. Its schedule copy can be changed
        independently.
      </p>
    </fieldset>
  );
}
function RelativeStart({
  value,
  onChange,
}: Pick<Parameters<typeof RelativeRepeatFields>[0], 'value' | 'onChange'>): JSX.Element {
  const program = useVocabulary('program');
  const [direction, setDirection] = useState(
    value.startOffsetDays === 0 ? 'on_creation' : value.startOffsetDays < 0 ? 'before' : 'after',
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Begins">
        <Select
          aria-label="Default schedule begins"
          value={direction}
          onChange={(event) => {
            const next = event.target.value;
            setDirection(next);
            const days = Math.max(1, Math.abs(value.startOffsetDays));
            onChange({
              ...value,
              startOffsetDays: next === 'on_creation' ? 0 : next === 'before' ? -days : days,
            });
          }}
        >
          <option value="on_creation">When the {program} is created</option>
          <option value="after">After {program} creation</option>
          <option value="before">Before {program} creation</option>
        </Select>
      </Field>
      {direction !== 'on_creation' ? (
        <Field label="Days from creation">
          <Input
            aria-label="Default schedule start offset days"
            type="number"
            min={1}
            max={36500}
            value={Math.abs(value.startOffsetDays)}
            onChange={(event) => {
              const days = Math.abs(Number(event.target.value));
              onChange({ ...value, startOffsetDays: direction === 'before' ? -days : days });
            }}
          />
        </Field>
      ) : null}
    </div>
  );
}
function RelativeEnd({
  value,
  onChange,
}: Pick<Parameters<typeof RelativeRepeatFields>[0], 'value' | 'onChange'>): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Ends">
        <Select
          aria-label="Default schedule ends"
          value={value.end.kind}
          onChange={(event) => {
            onChange({
              ...value,
              end:
                event.target.value === 'after_count'
                  ? { kind: 'after_count', count: 10 }
                  : { kind: 'never' },
            });
          }}
        >
          <option value="never">Never</option>
          <option value="after_count">After a number of runs</option>
        </Select>
      </Field>
      {value.end.kind === 'after_count' ? (
        <Field label="Number of runs">
          <Input
            aria-label="Default schedule run count"
            type="number"
            min={1}
            max={10000}
            value={value.end.count}
            onChange={(event) => {
              onChange({
                ...value,
                end: { kind: 'after_count', count: Number(event.target.value) },
              });
            }}
          />
        </Field>
      ) : null}
    </div>
  );
}
