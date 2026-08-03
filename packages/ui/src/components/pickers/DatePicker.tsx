'use client';

/**
 * `@docket/ui` — the single date and date-range pickers used everywhere in the product.
 *
 * @remarks
 * One component, one interaction contract. Every surface that sets a day — task due date,
 * project timeline, cycle window, initiative target — opens *this* popover and gets exactly
 * these behaviours:
 *
 * - **Open** — click or Enter on the trigger; the calendar takes focus on the committed day.
 * - **Move** — arrow keys move the highlight a day/week, PageUp/PageDown a month, Shift a year.
 * - **Commit** — Enter, Space, or a click on a day. Nothing else writes.
 * - **Escape** — closes and writes nothing, leaving the previously committed value intact.
 * - **Outside click** — same: closes, writes nothing.
 *
 * The previous implementation hosted a bare `<input type="date">`, which has no highlighted day
 * (so Enter and the arrows had nothing to act on) and deferred all of the above to whichever
 * browser the person happened to be using. The behaviour is now ours, identical on every
 * surface, and asserted in `apps/web/tests/pickers/`.
 *
 * Out-of-range days are *unreachable*, not merely rejected: the bounds default to the same
 * 1970–2200 window the DTOs enforce (`TASK_DATE_MIN`/`TASK_DATE_MAX`), so the picker can never
 * produce a value the API will refuse. Range pickers additionally bound each end by the other,
 * so a window that closes before it opens cannot be expressed.
 */
import * as React from 'react';

import { Calendar } from '../../icons';
import {
  Button,
  ControlGroup,
  OVERLAY_COLLISION_PADDING,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Text,
} from '../../primitives';

import {
  CALENDAR_MAX_DAY,
  CALENDAR_MIN_DAY,
  compareIso,
  formatCalendarDay,
  toCalendarDay,
  todayIso,
} from './calendar-date';
import { CalendarGrid } from './CalendarGrid';
import { PropertyTrigger } from './PropertyTrigger';

/**
 * Default short, locale-aware label for a stored day.
 *
 * @remarks
 * Returns `undefined` (never `"Invalid Date"`) for anything unreadable, which is what makes the
 * trigger fall through to its calm placeholder instead of rendering a broken string.
 */
function defaultFormat(value: string | null): string | undefined {
  return formatCalendarDay(value) ?? undefined;
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
  /** Earliest selectable day, inclusive. Defaults to the product's 1970 floor. */
  min?: string;
  /** Latest selectable day, inclusive. Defaults to the product's 2200 ceiling. */
  max?: string;
  /** Mark the field invalid (the host is showing a validation message about it). */
  invalid?: boolean;
  /** Id of the element carrying the host's validation message. */
  describedBy?: string;
}

/** The shared popover footer: a "Today" shortcut plus "Clear" when there is something to clear. */
function PickerFooter({
  onToday,
  onClear,
  todayDisabled,
}: {
  readonly onToday: () => void;
  readonly onClear: (() => void) | null;
  readonly todayDisabled: boolean;
}): React.JSX.Element {
  return (
    <ControlGroup controlSize="sm" className="border-outline-variant justify-between border-t pt-2">
      <Button type="button" variant="ghost" disabled={todayDisabled} onClick={onToday}>
        Today
      </Button>
      {onClear ? (
        <Button type="button" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      ) : null}
    </ControlGroup>
  );
}

/**
 * The compact single-date picker.
 *
 * @param props - The {@link DatePickerProps}.
 * @returns the rendered date trigger and its calendar popover.
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
  min = CALENDAR_MIN_DAY,
  max = CALENDAR_MAX_DAY,
  invalid,
  describedBy,
}: DatePickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const day = toCalendarDay(value);
  const label = formatLabel(day);
  const today = todayIso();

  const trigger = (
    <PropertyTrigger
      icon={label ? <Calendar className="text-on-surface-variant size-4" /> : undefined}
      label={label}
      placeholder={placeholder}
      ariaLabel={`${ariaLabel} — ${label ?? 'not set'}`}
      disabled={disabled}
      readOnly={readOnly}
      variant={triggerVariant}
      className={triggerClassName}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
    />
  );

  if (readOnly) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-3"
        collisionPadding={OVERLAY_COLLISION_PADDING}
        data-date-picker=""
      >
        <div className="flex flex-col gap-2">
          <CalendarGrid
            value={day}
            onSelect={(next) => {
              onChange(next);
              setOpen(false);
            }}
            min={min}
            max={max}
            ariaLabel={ariaLabel}
            autoFocus
          />
          <PickerFooter
            todayDisabled={compareIso(today, min) < 0 || compareIso(today, max) > 0}
            onToday={() => {
              onChange(today);
              setOpen(false);
            }}
            onClear={
              day
                ? () => {
                    onChange(null);
                    setOpen(false);
                  }
                : null
            }
          />
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
  /** Earliest selectable day, inclusive. Defaults to the product's 1970 floor. */
  min?: string;
  /** Latest selectable day, inclusive. Defaults to the product's 2200 ceiling. */
  max?: string;
}

/**
 * The compact date-range picker (e.g. a project's start → target timeline).
 *
 * @remarks
 * One calendar, two ends. A segmented Start/End control says which end the next selection lands
 * on, and choosing a start advances it to the end — so setting a whole window is click, click,
 * done, with no second grid to hunt for. The end can never precede the start (each end passes
 * the other as a bound), so the ordering invariant the API enforces is *unexpressible* here
 * rather than merely rejected after the fact.
 *
 * @param props - The {@link DateRangePickerProps}.
 * @returns the rendered range trigger and its calendar popover.
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
  min = CALENDAR_MIN_DAY,
  max = CALENDAR_MAX_DAY,
}: DateRangePickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<'start' | 'end'>('start');
  const start = toCalendarDay(value.start);
  const end = toCalendarDay(value.end);
  const startText = formatLabel(start);
  const endText = formatLabel(end);
  const summary = startText || endText ? `${startText ?? '—'} → ${endText ?? '—'}` : undefined;
  const today = todayIso();

  const trigger = (
    <PropertyTrigger
      icon={summary ? <Calendar className="text-on-surface-variant size-4" /> : undefined}
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

  const editingStart = editing === 'start';
  const gridMin = editingStart ? min : (start ?? min);
  const gridMax = editingStart ? (end ?? max) : max;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setEditing('start');
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-3"
        collisionPadding={OVERLAY_COLLISION_PADDING}
        data-date-picker=""
      >
        <div className="flex flex-col gap-2">
          <ControlGroup
            controlSize="sm"
            role="tablist"
            aria-label={`${ariaLabel} bound`}
            className="w-full"
          >
            {(
              [
                ['start', startLabel, startText],
                ['end', endLabel, endText],
              ] as const
            ).map(([bound, boundLabel, boundText]) => (
              <Button
                key={bound}
                type="button"
                role="tab"
                aria-selected={editing === bound}
                variant={editing === bound ? 'secondary' : 'ghost'}
                className="min-w-0 flex-1 justify-start"
                onClick={() => {
                  setEditing(bound);
                }}
              >
                <span className="flex min-w-0 flex-col items-start">
                  <Text token="label-small" tone="muted">
                    {boundLabel}
                  </Text>
                  <Text token="label-large" truncate>
                    {boundText ?? 'Not set'}
                  </Text>
                </span>
              </Button>
            ))}
          </ControlGroup>

          <CalendarGrid
            value={editingStart ? start : end}
            rangeEnd={editingStart ? end : start}
            onSelect={(next) => {
              if (editingStart) {
                // A start after the current end would invert the window; drop the stale end
                // rather than silently storing an impossible range.
                const nextEnd = end && compareIso(next, end) > 0 ? null : end;
                onChange({ start: next, end: nextEnd });
                setEditing('end');
                return;
              }
              onChange({ start, end: next });
              setOpen(false);
            }}
            min={gridMin}
            max={gridMax}
            ariaLabel={`${ariaLabel} ${editingStart ? startLabel : endLabel}`}
            autoFocus
          />

          <PickerFooter
            todayDisabled={compareIso(today, gridMin) < 0 || compareIso(today, gridMax) > 0}
            onToday={() => {
              if (editingStart) {
                onChange({ start: today, end: end && compareIso(today, end) > 0 ? null : end });
                setEditing('end');
                return;
              }
              onChange({ start, end: today });
              setOpen(false);
            }}
            onClear={
              start || end
                ? () => {
                    onChange({ start: null, end: null });
                    setEditing('start');
                    setOpen(false);
                  }
                : null
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
