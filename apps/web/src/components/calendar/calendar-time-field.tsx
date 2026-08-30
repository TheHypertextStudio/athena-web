'use client';

import { cn } from '@docket/ui/lib/utils';
import { focusRingInset, Input, surfaceToneColor } from '@docket/ui/primitives';
import { type JSX, useId } from 'react';

import { type LocalInputOccurrence, resolveLocalInputValue } from './datetime-input';

/** Props for one timezone-aware native datetime field. */
export interface CalendarTimeFieldProps {
  readonly label: string;
  readonly value: string;
  readonly displayTimezone: string;
  readonly occurrence: LocalInputOccurrence | null;
  readonly onValueChange: (value: string) => void;
  readonly onOccurrenceChange: (occurrence: LocalInputOccurrence) => void;
  readonly disabled?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  readonly describedBy?: string | undefined;
  /** Native input shape; Agenda supplies a separate date for its time-only editor. */
  readonly inputType?: 'datetime-local' | 'time' | undefined;
  /** Calendar date paired with a time-only value for DST resolution. */
  readonly date?: string | undefined;
}

/**
 * Render a datetime-local field with an explicit Earlier/Later choice only during a DST fold.
 */
export function CalendarTimeField({
  label,
  value,
  displayTimezone,
  occurrence,
  onValueChange,
  onOccurrenceChange,
  disabled = false,
  invalid = false,
  describedBy,
  inputType = 'datetime-local',
  date,
}: CalendarTimeFieldProps): JSX.Element {
  const inputId = useId();
  const localValue = inputType === 'time' ? (date ? `${date}T${value}` : '') : value;
  const resolution = resolveLocalInputValue(localValue, displayTimezone);
  const candidates = resolution?.kind === 'repeated' ? resolution.candidates : null;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={inputId} className="text-label-medium text-on-surface-variant">
        {label}
      </label>
      <Input
        id={inputId}
        type={inputType}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
      />
      {/*
        A DST fold is the only time this appears, so it reads as a segmented control on a recessed
        tonal track rather than another outlined box stacked under the field.
      */}
      {candidates ? (
        <div
          role="group"
          aria-label={`${label} occurrence`}
          className={cn(surfaceToneColor('canvas'), 'grid grid-cols-2 gap-0.5 rounded-md p-0.5')}
        >
          {candidates.map((candidate) => {
            const selected = occurrence === candidate.occurrence;
            const occurrenceLabel = candidate.occurrence === 'earlier' ? 'Earlier' : 'Later';
            return (
              <button
                key={candidate.occurrence}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => {
                  onOccurrenceChange(candidate.occurrence);
                }}
                className={cn(
                  'text-label-large min-h-10 min-w-0 truncate rounded-md px-1 transition-colors motion-reduce:transition-none',
                  selected
                    ? surfaceToneColor('prominent')
                    : 'text-on-surface-variant hover:bg-surface-container-high',
                  focusRingInset,
                )}
              >
                {occurrenceLabel} · {candidate.zoneLabel}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
