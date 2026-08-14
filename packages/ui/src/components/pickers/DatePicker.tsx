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
import { cn } from '../../lib/utils';
import {
  Button,
  ControlGroup,
  OVERLAY_COLLISION_PADDING,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
      icon={<Calendar className="text-on-surface-variant size-4" />}
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
  /** The calm empty prompt shown for an unset start bound. */
  startPlaceholder: string;
  /** The calm empty prompt shown for an unset end bound. */
  endPlaceholder: string;
  /** Format an ISO date for each trigger; defaults to a short locale day. */
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
 * Two independent date chips for one bounded range.
 *
 * @remarks
 * Start and end are separate properties on screen, so neither an arrow summary nor a compressed
 * segmented heading has to explain which value is missing or being edited. The two controls still
 * share the range invariant: the committed end caps the start calendar, and the committed start
 * floors the end calendar. Either bound may be cleared without erasing the other.
 *
 * @param props - The {@link DateRangePickerProps}.
 * @returns the non-wrapping pair of date controls.
 */
export function DateRangePicker({
  value,
  onChange,
  startPlaceholder,
  endPlaceholder,
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
  const start = toCalendarDay(value.start);
  const end = toCalendarDay(value.end);

  return (
    <div role="group" aria-label={ariaLabel} className="flex max-w-full flex-nowrap gap-2">
      <DatePicker
        value={start}
        onChange={(nextStart) => {
          onChange({ start: nextStart, end });
        }}
        placeholder={startPlaceholder}
        formatLabel={formatLabel}
        ariaLabel={`${ariaLabel} ${startLabel}`}
        disabled={disabled}
        readOnly={readOnly}
        triggerVariant={triggerVariant}
        triggerClassName={cn(triggerClassName, 'min-w-0 shrink-0 whitespace-nowrap')}
        min={min}
        max={end ?? max}
      />
      <DatePicker
        value={end}
        onChange={(nextEnd) => {
          onChange({ start, end: nextEnd });
        }}
        placeholder={endPlaceholder}
        formatLabel={formatLabel}
        ariaLabel={`${ariaLabel} ${endLabel}`}
        disabled={disabled}
        readOnly={readOnly}
        triggerVariant={triggerVariant}
        triggerClassName={cn(triggerClassName, 'min-w-0 shrink-0 whitespace-nowrap')}
        min={start ?? min}
        max={max}
      />
    </div>
  );
}
