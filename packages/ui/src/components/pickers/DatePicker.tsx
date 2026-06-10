'use client';

/**
 * `@docket/ui` — the compact date and date-range pickers.
 *
 * @remarks
 * A {@link PropertyTrigger} that opens a {@link Popover} hosting a native
 * `<input type="date">` (or two, for a range). The native control is keyboard-friendly,
 * accessible, locale-aware, and — crucially — emits the exact `YYYY-MM-DD` ISO string the
 * `z.iso.date()` create/update DTOs expect, so no parsing or extra calendar dependency is
 * needed. The trigger shows the chosen date(s) through the caller's `formatLabel` (defaulting
 * to a short locale day) or a calm "Set <field>" prompt when unset; a "Clear" action inside
 * the popover resets the value(s) to `null`. Values are *controlled* by the caller.
 */
import * as React from 'react';

import { Calendar } from '../../icons';
import { cn } from '../../lib/utils';
import { Button, focusRing, Popover, PopoverContent, PopoverTrigger } from '../../primitives';

import { PropertyTrigger } from './PropertyTrigger';

/**
 * Shared class for the native `<input type="date">` fields inside the date popovers.
 *
 * @remarks
 * A boxed field with breathing room (not a packed row), so it composes the standalone
 * {@link focusRing} rather than a hand-written ring. The 36px height + `px-3` matches the
 * standard interactive control rhythm.
 */
const DATE_FIELD_CLASS =
  'border-outline-variant text-on-surface h-9 rounded-md border bg-transparent px-3 text-body';

/** Default short, locale-aware label for an ISO `YYYY-MM-DD` date, or `undefined` when absent. */
function defaultFormat(value: string | null): string | undefined {
  if (!value) return undefined;
  // Parse as a *local* calendar day (append midday) so the day never shifts across zones.
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Props for {@link DatePicker}. */
export interface DatePickerProps {
  /** The current ISO `YYYY-MM-DD` date, or `null` when unset. */
  value: string | null;
  /** Report the chosen ISO date, or `null` when cleared. */
  onChange: (value: string | null) => void;
  /** The calm empty prompt shown when unset (e.g. "Set due date"). */
  placeholder: string;
  /** Format an ISO date for the trigger; defaults to a short locale day. */
  formatLabel?: (value: string | null) => string | undefined;
  /** Accessible label prefix (e.g. "Due date", "Target date"). */
  ariaLabel?: string;
  /** Disable the trigger (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** Render as plain text with no affordance (actor lacks edit capability). */
  readOnly?: boolean;
  /** Trigger weight: `ghost` (panel rows) or `outline` (composer strip). */
  triggerVariant?: 'ghost' | 'outline';
  /** Extra classes for the trigger. */
  triggerClassName?: string;
}

/**
 * The compact single-date picker.
 *
 * @param props - The {@link DatePickerProps}.
 * @returns the rendered date trigger + popover date field.
 */
export function DatePicker({
  value,
  onChange,
  placeholder,
  formatLabel = defaultFormat,
  ariaLabel = 'Date',
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
}: DatePickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const label = formatLabel(value);

  const trigger = (
    <PropertyTrigger
      icon={label ? <Calendar className="text-on-surface-variant size-3.5" /> : undefined}
      label={label}
      placeholder={placeholder}
      ariaLabel={`${ariaLabel} — ${label ?? 'not set'}`}
      disabled={disabled}
      readOnly={readOnly}
      variant={triggerVariant}
      className={triggerClassName}
    />
  );

  if (readOnly) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3">
        <div className="flex flex-col gap-2">
          <input
            type="date"
            autoFocus
            value={value ?? ''}
            aria-label={ariaLabel}
            onChange={(event) => {
              onChange(event.target.value === '' ? null : event.target.value);
            }}
            className={cn(DATE_FIELD_CLASS, focusRing)}
          />
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start px-2"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A start/end ISO date pair; either bound may be `null`. */
export interface DateRange {
  /** ISO `YYYY-MM-DD` start date, or `null` when unset. */
  start: string | null;
  /** ISO `YYYY-MM-DD` end date, or `null` when unset. */
  end: string | null;
}

/** Props for {@link DateRangePicker}. */
export interface DateRangePickerProps {
  /** The current start/end ISO date pair. */
  value: DateRange;
  /** Report a changed range (either bound may be `null`). */
  onChange: (value: DateRange) => void;
  /** The calm empty prompt shown when neither bound is set (e.g. "Set timeline"). */
  placeholder: string;
  /** Format an ISO date for the trigger summary; defaults to a short locale day. */
  formatLabel?: (value: string | null) => string | undefined;
  /** Accessible label prefix (e.g. "Timeline"). */
  ariaLabel?: string;
  /** Label for the start field inside the popover. */
  startLabel?: string;
  /** Label for the end field inside the popover. */
  endLabel?: string;
  /** Disable the trigger (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** Render as plain text with no affordance (actor lacks edit capability). */
  readOnly?: boolean;
  /** Trigger weight: `ghost` (panel rows) or `outline` (composer strip). */
  triggerVariant?: 'ghost' | 'outline';
  /** Extra classes for the trigger. */
  triggerClassName?: string;
}

/**
 * The compact date-range picker (e.g. a project's start → target timeline).
 *
 * @param props - The {@link DateRangePickerProps}.
 * @returns the rendered range trigger + popover with start/end fields.
 */
export function DateRangePicker({
  value,
  onChange,
  placeholder,
  formatLabel = defaultFormat,
  ariaLabel = 'Timeline',
  startLabel = 'Start',
  endLabel = 'End',
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
}: DateRangePickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const start = formatLabel(value.start);
  const end = formatLabel(value.end);
  const summary = start || end ? `${start ?? '—'} → ${end ?? '—'}` : undefined;

  const trigger = (
    <PropertyTrigger
      icon={summary ? <Calendar className="text-on-surface-variant size-3.5" /> : undefined}
      label={summary}
      placeholder={placeholder}
      ariaLabel={`${ariaLabel} — ${summary ?? 'not set'}`}
      disabled={disabled}
      readOnly={readOnly}
      variant={triggerVariant}
      className={triggerClassName}
    />
  );

  if (readOnly) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3">
        <div className="flex flex-col gap-3">
          <label className="text-on-surface-variant flex flex-col gap-1 text-xs font-medium">
            {startLabel}
            <input
              type="date"
              autoFocus
              value={value.start ?? ''}
              aria-label={`${ariaLabel} ${startLabel}`}
              max={value.end ?? undefined}
              onChange={(event) => {
                onChange({
                  ...value,
                  start: event.target.value === '' ? null : event.target.value,
                });
              }}
              className={cn(DATE_FIELD_CLASS, focusRing)}
            />
          </label>
          <label className="text-on-surface-variant flex flex-col gap-1 text-xs font-medium">
            {endLabel}
            <input
              type="date"
              value={value.end ?? ''}
              aria-label={`${ariaLabel} ${endLabel}`}
              min={value.start ?? undefined}
              onChange={(event) => {
                onChange({ ...value, end: event.target.value === '' ? null : event.target.value });
              }}
              className={cn(DATE_FIELD_CLASS, focusRing)}
            />
          </label>
          {value.start || value.end ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start px-2"
              onClick={() => {
                onChange({ start: null, end: null });
                setOpen(false);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
