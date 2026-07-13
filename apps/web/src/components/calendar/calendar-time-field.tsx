'use client';

import { Input } from '@docket/ui/primitives';
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
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
  /** Native input shape; Agenda supplies a separate date for its time-only editor. */
  readonly inputType?: 'datetime-local' | 'time';
  /** Calendar date paired with a time-only value for DST resolution. */
  readonly date?: string;
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
    <div className="flex min-w-0 flex-col gap-1 text-xs font-medium">
      <label htmlFor={inputId} className="text-on-surface-variant">
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
      {candidates ? (
        <div
          role="group"
          aria-label={`${label} occurrence`}
          className="border-outline-variant grid grid-cols-2 gap-0.5 rounded-md border p-0.5"
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
                className={
                  selected
                    ? 'bg-primary/15 text-on-surface focus-visible:ring-ring min-h-10 min-w-0 rounded px-1 text-[11px] font-semibold focus-visible:ring-2 focus-visible:outline-none'
                    : 'text-on-surface-variant hover:bg-surface-container-high focus-visible:ring-ring min-h-10 min-w-0 rounded px-1 text-[11px] focus-visible:ring-2 focus-visible:outline-none'
                }
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
