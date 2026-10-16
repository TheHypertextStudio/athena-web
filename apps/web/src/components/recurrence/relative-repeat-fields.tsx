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
      <div className="grid min-w-0 grid-cols-[auto_4rem_minmax(0,1fr)] items-center gap-2">
        <span className="text-label-large">Repeat every</span>
        <Input
          aria-label="Repeat interval"
          type="number"
          min={1}
          value={value.interval}
          onChange={(event) => {
            onChange({ ...value, interval: Number(event.target.value) });
          }}
        />
        <Select
          aria-label="Repeat frequency"
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
          <option value="daily">{value.interval === 1 ? 'day' : 'days'}</option>
          <option value="weekly">{value.interval === 1 ? 'week' : 'weeks'}</option>
          <option value="monthly">{value.interval === 1 ? 'month' : 'months'}</option>
          <option value="yearly">{value.interval === 1 ? 'year' : 'years'}</option>
        </Select>
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
        These settings apply each time you create a {program}. You can change its repeat schedule
        later.
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
      <Field label="First occurrence">
        <Select
          aria-label="First occurrence"
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
          <option value="on_creation">When this {program} is created</option>
          <option value="after">After this {program} is created</option>
          <option value="before">Before this {program} is created</option>
        </Select>
      </Field>
      {direction !== 'on_creation' ? (
        <Field label={direction === 'before' ? 'Days before creation' : 'Days after creation'}>
          <Input
            aria-label="Days before or after creation"
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
      <Field label="Stops">
        <Select
          aria-label="Stops repeating"
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
          <option value="after_count">After a set number of times</option>
        </Select>
      </Field>
      {value.end.kind === 'after_count' ? (
        <Field label="Number of times">
          <Input
            aria-label="Number of times"
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
