'use client';

import {
  timeframeLabel,
  type DateResolution,
  type PlanningTimeframe,
  type TimeframeEdge,
} from '@docket/work/planning-timeframe';
import * as React from 'react';

import { Calendar, Check, ChevronLeft, ChevronRight } from '../../icons';
import { cn } from '../../lib/utils';
import {
  Button,
  ControlGroup,
  focusRing,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Text,
} from '../../primitives';
import { menuItemClass } from '../../primitives/menu-styles';
import { OVERLAY_COLLISION_PADDING } from '../../primitives/overlay-inset';

import { CALENDAR_MAX_DAY, CALENDAR_MIN_DAY, todayIso } from './calendar-date';
import { CalendarGrid } from './CalendarGrid';
import { PropertyTrigger } from './PropertyTrigger';
import { nearbyTimeframeOptions } from './timeframe-options';

type TimeframeMode = DateResolution | 'day';

interface PrecisionOption {
  readonly value: TimeframeMode;
  readonly label: string;
}

const PRECISION_OPTIONS: readonly PrecisionOption[] = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'halfYear', label: 'Half-year' },
  { value: 'year', label: 'Year' },
  { value: 'day', label: 'Specific date' },
];

function savedMode(value: PlanningTimeframe | null): TimeframeMode {
  return value?.resolution ?? (value ? 'day' : 'month');
}

function savedLabel(value: PlanningTimeframe | null): string | undefined {
  if (!value) return undefined;
  try {
    return timeframeLabel(value.date, value.resolution, value.fiscalYearStartMonth);
  } catch {
    return undefined;
  }
}

function modeLabel(mode: DateResolution): string {
  return PRECISION_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

/** Props for {@link TimeframePicker}. */
export interface TimeframePickerProps {
  /** Human-readable field name, such as `Target date`. */
  readonly label: string;
  /** Current precise or broad planning value. */
  readonly value: PlanningTimeframe | null;
  /** Zero-based month used for new broad selections. */
  readonly fiscalYearStartMonth: number;
  /** Boundary stored by this field. */
  readonly edge: TimeframeEdge;
  /** Commit a complete planning value or clear it. */
  readonly onChange: (value: PlanningTimeframe | null) => void;
  /** Disable the trigger while its host is saving. */
  readonly disabled?: boolean | undefined;
  /** Render the saved label without an edit affordance. */
  readonly readOnly?: boolean | undefined;
  /** Trigger weight for detail rows or composer strips. */
  readonly triggerVariant?: 'ghost' | 'outline' | undefined;
  /** Additional trigger layout classes. */
  readonly triggerClassName?: string | undefined;
  /** Earliest precise day offered by the delegated calendar. */
  readonly min?: string | undefined;
  /** Latest precise day offered by the delegated calendar. */
  readonly max?: string | undefined;
  /** Mark this field as the subject of a host validation error. */
  readonly invalid?: boolean | undefined;
  /** Id of the host validation message. */
  readonly describedBy?: string | undefined;
  /** Observe visibility so hosts can load calendar settings only when this editor opens. */
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}

/**
 * Choose a Linear-compatible broad planning period or one precise calendar day.
 *
 * @param props - Controlled value, fiscal calendar, field edge, and trigger presentation.
 * @returns One property trigger and its planning-date popover.
 */
export function TimeframePicker({
  label,
  value,
  fiscalYearStartMonth,
  edge,
  onChange,
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
  min = CALENDAR_MIN_DAY,
  max = CALENDAR_MAX_DAY,
  invalid,
  describedBy,
  onOpenChange,
}: TimeframePickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<TimeframeMode>(() => savedMode(value));
  const [windowOffset, setWindowOffset] = React.useState(0);
  const precisionRef = React.useRef<HTMLDivElement | null>(null);
  const visibleLabel = savedLabel(value);
  const placeholder = `Set ${label.toLocaleLowerCase()}`;
  const broadOptions =
    mode === 'day'
      ? []
      : nearbyTimeframeOptions(todayIso(), mode, fiscalYearStartMonth, edge, windowOffset);

  const trigger = (
    <PropertyTrigger
      icon={<Calendar className="text-on-surface-variant size-4" />}
      label={visibleLabel}
      placeholder={placeholder}
      ariaLabel={`${label} — ${visibleLabel ?? 'not set'}`}
      disabled={disabled}
      readOnly={readOnly}
      variant={triggerVariant}
      className={triggerClassName}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
    />
  );

  if (readOnly) return trigger;

  const selectMode = (next: TimeframeMode): void => {
    setMode(next);
    setWindowOffset(0);
  };

  const handlePrecisionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = Array.from(
      precisionRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (options.length === 0) return;
    const current = options.findIndex((option) => option === document.activeElement);
    let next = current;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % options.length;
    if (event.key === 'ArrowUp')
      next = current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    event.preventDefault();
    options[next]?.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setMode(savedMode(value));
          setWindowOffset(0);
        }
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className="w-[22rem] max-w-[calc(100vw-2rem)] p-2"
        collisionPadding={OVERLAY_COLLISION_PADDING}
        data-timeframe-picker=""
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          precisionRef.current
            ?.querySelector<HTMLButtonElement>('[role="option"][tabindex="0"]')
            ?.focus();
        }}
      >
        <div className="flex flex-col gap-2">
          <div
            ref={precisionRef}
            role="listbox"
            aria-label="Date precision"
            className="grid gap-0.5"
            onKeyDown={handlePrecisionKeyDown}
          >
            {PRECISION_OPTIONS.map((option) => {
              const selected = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className={cn(menuItemClass('standard', { selected }), focusRing)}
                  onClick={() => {
                    selectMode(option.value);
                  }}
                >
                  <span className="min-w-0 flex-1 text-left">{option.label}</span>
                  {selected ? <Check aria-hidden className="size-4" /> : null}
                </button>
              );
            })}
          </div>

          <div className="border-outline-variant border-t pt-2">
            {mode === 'day' ? (
              <CalendarGrid
                value={value?.date ?? null}
                onSelect={(date) => {
                  onChange({ date, resolution: null, fiscalYearStartMonth: null });
                  setOpen(false);
                }}
                min={min}
                max={max}
                ariaLabel={label}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <ControlGroup controlSize="sm" className="justify-between px-1">
                  <Text token="label-large" as="h2">
                    {modeLabel(mode)}
                  </Text>
                  <ControlGroup controlSize="sm">
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      aria-label="Previous periods"
                      onClick={() => {
                        setWindowOffset((current) => current - 7);
                      }}
                    >
                      <ChevronLeft aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      aria-label="Next periods"
                      onClick={() => {
                        setWindowOffset((current) => current + 7);
                      }}
                    >
                      <ChevronRight aria-hidden />
                    </Button>
                  </ControlGroup>
                </ControlGroup>
                <div
                  role="listbox"
                  aria-label={`${modeLabel(mode)} choices`}
                  className="grid gap-0.5"
                >
                  {broadOptions.map((option) => {
                    const selected =
                      value?.date === option.date &&
                      value.resolution === option.resolution &&
                      value.fiscalYearStartMonth === option.fiscalYearStartMonth;
                    return (
                      <button
                        key={`${option.date}:${option.resolution}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={cn(menuItemClass('standard', { selected }), focusRing)}
                        onClick={() => {
                          onChange({
                            date: option.date,
                            resolution: option.resolution,
                            fiscalYearStartMonth: option.fiscalYearStartMonth,
                          });
                          setOpen(false);
                        }}
                      >
                        <span className="min-w-0 flex-1 text-left">{option.label}</span>
                        {selected ? <Check aria-hidden className="size-4" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {value ? (
            <div className="border-outline-variant flex justify-end border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Controlled start and target values for {@link TimeframeRangePicker}. */
export interface TimeframeRangeValue {
  /** Project start planning value. */
  readonly start: PlanningTimeframe | null;
  /** Project target planning value. */
  readonly target: PlanningTimeframe | null;
}

/** Props for {@link TimeframeRangePicker}. */
export interface TimeframeRangePickerProps {
  /** Current independent start and target planning values. */
  readonly value: TimeframeRangeValue;
  /** Zero-based fiscal month used for new broad values. */
  readonly fiscalYearStartMonth: number;
  /** Commit a range after anchor-order validation. */
  readonly onChange: (value: TimeframeRangeValue) => void;
  /** Disable both controls while their host is saving. */
  readonly disabled?: boolean | undefined;
  /** Render both values without edit affordances. */
  readonly readOnly?: boolean | undefined;
  /** Trigger weight for detail rows or composer strips. */
  readonly triggerVariant?: 'ghost' | 'outline' | undefined;
  /** Additional layout classes for both triggers. */
  readonly triggerClassName?: string | undefined;
  /** Accessible group and field prefix. */
  readonly ariaLabel?: string | undefined;
  /** Label for the start field. Defaults to the group label plus `start`. */
  readonly startLabel?: string | undefined;
  /** Label for the target field. Defaults to the group label plus `target`. */
  readonly targetLabel?: string | undefined;
}

/**
 * Compose independent start and target timeframe fields under one ordering invariant.
 *
 * @param props - Controlled range, fiscal calendar, and presentation.
 * @returns Two timeframe controls and an inline validation message when a change would invert them.
 */
export function TimeframeRangePicker({
  value,
  fiscalYearStartMonth,
  onChange,
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
  ariaLabel = 'Timeline',
  startLabel = `${ariaLabel} start`,
  targetLabel = `${ariaLabel} target`,
}: TimeframeRangePickerProps): React.JSX.Element {
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();

  const commit = (next: TimeframeRangeValue): void => {
    if (next.start && next.target && next.start.date > next.target.date) {
      setError('Start must be on or before target.');
      return;
    }
    setError(null);
    onChange(next);
  };

  return (
    <div className="flex max-w-full flex-col gap-1">
      <div role="group" aria-label={ariaLabel} className="flex max-w-full flex-nowrap gap-2">
        <TimeframePicker
          label={startLabel}
          value={value.start}
          fiscalYearStartMonth={fiscalYearStartMonth}
          edge="start"
          onChange={(start) => {
            commit({ start, target: value.target });
          }}
          disabled={disabled}
          readOnly={readOnly}
          triggerVariant={triggerVariant}
          triggerClassName={cn(triggerClassName, 'min-w-0 shrink-0 whitespace-nowrap')}
          invalid={error !== null}
          describedBy={error ? errorId : undefined}
        />
        <TimeframePicker
          label={targetLabel}
          value={value.target}
          fiscalYearStartMonth={fiscalYearStartMonth}
          edge="target"
          onChange={(target) => {
            commit({ start: value.start, target });
          }}
          disabled={disabled}
          readOnly={readOnly}
          triggerVariant={triggerVariant}
          triggerClassName={cn(triggerClassName, 'min-w-0 shrink-0 whitespace-nowrap')}
          invalid={error !== null}
          describedBy={error ? errorId : undefined}
        />
      </div>
      {error ? (
        <Text id={errorId} role="alert" token="body-small" tone="error">
          {error}
        </Text>
      ) : null}
    </div>
  );
}
