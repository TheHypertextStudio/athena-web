'use client';

/**
 * `pickers/estimate-time-picker` — set a task's time estimate (`estimateMinutes`).
 *
 * @remarks
 * Sunsama's planned-time control: a column of common durations plus a field that takes whatever
 * the person types (`45`, `1h 30m`, `1:30`; see {@link parseEstimate}). While the field has text,
 * the durations step aside and the parsed time is the one row, so Enter commits it.
 *
 * A standalone minutes control: it reads no workspace setting and is unrelated to point estimates
 * (`EstimatePicker`), so it behaves the same on every task and every surface. {@link EstimateTimeList}
 * is the popover body, shared with the list overlay (`estimate-time-picker-overlay.tsx`);
 * {@link EstimateTimePicker} wraps it in a trigger for surfaces that have their own anchor.
 */
import { PickerList, type PickerOption, PropertyTrigger } from '@docket/ui/components';
import { Hourglass } from '@docket/ui/icons';
import { type ControlSize, Popover, PopoverContent, PopoverTrigger } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { formatEstimate } from '@/lib/format-estimate';
import { parseEstimate } from '@/lib/parse-estimate';

/** The accessible name shared by the trigger and the list. */
const ESTIMATE_TIME_LABEL = 'Time estimate';

/** Common durations, in minutes. */
const PRESET_MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240] as const;

/** The durations as picker rows, labelled `h:mm` like every estimate. */
const PRESET_OPTIONS: readonly PickerOption[] = PRESET_MINUTES.map((minutes) => ({
  value: String(minutes),
  label: formatEstimate(minutes) ?? String(minutes),
}));

/** The typed text as a row label: the parsed time, or the text itself. */
function typedLabel(query: string): string {
  return formatEstimate(parseEstimate(query)) ?? query;
}

/** Props for {@link EstimateTimeList}. */
export interface EstimateTimeListProps {
  /** The current estimate in minutes, or `null` when unset (or mixed across several tasks). */
  readonly value: number | null;
  /** Report the chosen estimate in minutes, or `null` to clear it. */
  readonly onChange: (minutes: number | null) => void;
  /** Offer the clear row even when `value` is `null` (several tasks with differing estimates). */
  readonly clearable?: boolean | undefined;
}

/**
 * The durations, the typed-time field, and a clear row.
 *
 * @param props - See {@link EstimateTimeListProps}.
 * @returns the list body for a popover.
 */
export function EstimateTimeList({
  value,
  onChange,
  clearable = false,
}: EstimateTimeListProps): JSX.Element {
  const [query, setQuery] = useState('');
  const typing = query.trim() !== '';
  const showClear = !typing && (clearable || value !== null);
  return (
    <PickerList
      options={typing ? [] : PRESET_OPTIONS}
      selected={value === null ? null : String(value)}
      onSelect={(minutes) => {
        onChange(Number(minutes));
      }}
      query={query}
      onQueryChange={setQuery}
      filter="none"
      searchPlaceholder="Custom time"
      emptyText="Not a time"
      ariaLabel={ESTIMATE_TIME_LABEL}
      clear={
        showClear
          ? {
              label: 'Clear',
              onClear: () => {
                onChange(null);
              },
            }
          : null
      }
      create={{
        render: typedLabel,
        canCreate: (typed) => parseEstimate(typed) !== null,
        onCreate: (typed) => {
          const minutes = parseEstimate(typed);
          if (minutes !== null) onChange(minutes);
        },
      }}
    />
  );
}

/** Props for {@link EstimateTimePicker}. */
export interface EstimateTimePickerProps {
  /** The task's estimate in minutes, or `null` when unset. */
  readonly value: number | null;
  /** Report the chosen estimate in minutes, or `null` when cleared. */
  readonly onChange: (minutes: number | null) => void;
  /** The trigger's empty prompt. */
  readonly placeholder?: string | undefined;
  /** Show the value as text with no affordance (the viewer cannot edit the task). */
  readonly readOnly?: boolean | undefined;
  /** Disable the trigger. */
  readonly disabled?: boolean | undefined;
  /** Trigger weight: `ghost` for rows and mastheads, `secondary` for composers. */
  readonly triggerVariant?: 'ghost' | 'secondary' | undefined;
  /** Size the trigger on the control scale, to match the buttons beside it. */
  readonly triggerControlSize?: ControlSize | undefined;
  /** Extra classes for the trigger. */
  readonly triggerClassName?: string | undefined;
}

/**
 * A time-estimate trigger with its popover.
 *
 * @param props - See {@link EstimateTimePickerProps}.
 * @returns the trigger, which opens {@link EstimateTimeList}.
 */
export function EstimateTimePicker({
  value,
  onChange,
  placeholder = 'Estimate time',
  readOnly,
  disabled,
  triggerVariant = 'ghost',
  triggerControlSize,
  triggerClassName,
}: EstimateTimePickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const label = formatEstimate(value) ?? undefined;
  const trigger = (
    <PropertyTrigger
      icon={<Hourglass className="text-on-surface-variant size-4" />}
      label={label}
      placeholder={placeholder}
      ariaLabel={`${ESTIMATE_TIME_LABEL} — ${label ?? 'not set'}`}
      disabled={disabled}
      readOnly={readOnly}
      variant={triggerVariant}
      controlSize={triggerControlSize}
      className={triggerClassName}
    />
  );

  if (readOnly) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent width="sm">
        <EstimateTimeList
          value={value}
          onChange={(minutes) => {
            onChange(minutes);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
