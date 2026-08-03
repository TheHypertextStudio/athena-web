'use client';

/**
 * `@docket/ui` — the month calendar every date picker in the product is built on.
 *
 * @remarks
 * There is exactly one of these. Before it, each surface hosted a bare `<input type="date">`,
 * which meant the picker had no highlighted day for Enter to commit and no grid for the arrow
 * keys to move through — the "strange interaction semantics" the author called out. A real grid
 * makes the five behaviours the launch contract grades (Escape, outside-click, Enter, arrows,
 * identical open/select) properties of one component rather than promises repeated per surface.
 *
 * Semantics follow the WAI-ARIA date-grid pattern: a `role="grid"` of `gridcell` buttons with a
 * single roving tab stop, so the whole month is one tab stop and the arrows move *within* it.
 * Geometry follows MD3's date-picker spec — 40dp round day cells on a 7-column track, the
 * selected day filled with `primary`, today marked by an outline rather than a fill.
 *
 * The grid is a *pure highlight machine*: it never mutates the caller's value on its own. Moving
 * the highlight is `onFocusedChange`; committing is `onSelect`, raised only by Enter, Space, or a
 * click. That separation is what lets Escape close a popover without saving.
 */
import * as React from 'react';

import { ChevronLeft, ChevronRight } from '../../icons';
import { cn } from '../../lib/utils';
import { Button, ControlGroup, focusRing, Text } from '../../primitives';

import {
  addDays,
  addMonths,
  CALENDAR_MAX_DAY,
  CALENDAR_MIN_DAY,
  clampIso,
  compareIso,
  DAYS_PER_WEEK,
  endOfMonth,
  localeWeekStart,
  monthGrid,
  monthLabel,
  startOfMonth,
  todayIso,
  weekdayLabels,
} from './calendar-date';

/** Props for {@link CalendarGrid}. */
export interface CalendarGridProps {
  /** The committed day, or `null` when unset. Highlighted and marked `aria-selected`. */
  readonly value: string | null;
  /** Commit a day. Raised only by Enter, Space, or a click — never by moving the highlight. */
  readonly onSelect: (value: string) => void;
  /** Earliest selectable day, inclusive. Defaults to {@link CALENDAR_MIN_DAY}. */
  readonly min?: string;
  /** Latest selectable day, inclusive. Defaults to {@link CALENDAR_MAX_DAY}. */
  readonly max?: string;
  /** Accessible name for the grid, e.g. "Due date". */
  readonly ariaLabel: string;
  /** A second day to mark as part of the same range (the other end of a start→end pair). */
  readonly rangeEnd?: string | null;
  /** Take DOM focus on mount — used when the grid opens inside a popover. */
  readonly autoFocus?: boolean;
}

/** Shared geometry for one day cell: MD3's 40dp round target on a 7-column track. */
const DAY_CELL =
  'text-body-medium relative flex size-10 items-center justify-center rounded-full tabular-nums';

/**
 * A keyboard-operable month calendar.
 *
 * @param props - The {@link CalendarGridProps}.
 * @returns The rendered month grid with its month navigation header.
 */
export function CalendarGrid({
  value,
  onSelect,
  min = CALENDAR_MIN_DAY,
  max = CALENDAR_MAX_DAY,
  ariaLabel,
  rangeEnd = null,
  autoFocus = false,
}: CalendarGridProps): React.JSX.Element {
  const today = React.useMemo(() => todayIso(), []);
  const weekStart = React.useMemo(() => localeWeekStart(), []);
  const weekdays = React.useMemo(() => weekdayLabels(weekStart), [weekStart]);

  /**
   * The highlighted day. Seeded from the committed value, else today, always clamped into the
   * allowed window so an out-of-range stored value cannot strand the roving tab stop on a
   * disabled cell.
   */
  const [focused, setFocused] = React.useState(() => clampIso(value ?? today, min, max));
  const [shouldFocusCell, setShouldFocusCell] = React.useState(autoFocus);
  const gridRef = React.useRef<HTMLDivElement | null>(null);

  // Follow the committed value when the host changes it (e.g. the range picker's other field).
  React.useEffect(() => {
    if (value) setFocused(clampIso(value, min, max));
  }, [value, min, max]);

  React.useEffect(() => {
    if (!shouldFocusCell) return;
    const cell = gridRef.current?.querySelector<HTMLElement>('[data-calendar-day][tabindex="0"]');
    cell?.focus();
    setShouldFocusCell(false);
  }, [shouldFocusCell, focused]);

  const weeks = React.useMemo(() => monthGrid(focused, weekStart), [focused, weekStart]);
  const disabled = React.useCallback(
    (iso: string) => compareIso(iso, min) < 0 || compareIso(iso, max) > 0,
    [min, max],
  );

  const moveTo = React.useCallback(
    (iso: string) => {
      setFocused(clampIso(iso, min, max));
      setShouldFocusCell(true);
    },
    [min, max],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keyed: Record<string, () => string> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -DAYS_PER_WEEK),
      ArrowDown: () => addDays(focused, DAYS_PER_WEEK),
      Home: () => startOfMonth(focused),
      End: () => endOfMonth(focused),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
    };
    const next = keyed[event.key];
    if (next) {
      event.preventDefault();
      moveTo(next());
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!disabled(focused)) onSelect(focused);
    }
  };

  const rangeLow = value && rangeEnd ? (compareIso(value, rangeEnd) <= 0 ? value : rangeEnd) : null;
  const rangeHigh =
    value && rangeEnd ? (compareIso(value, rangeEnd) <= 0 ? rangeEnd : value) : null;

  const step = (delta: number): void => {
    moveTo(addMonths(focused, delta));
  };
  const prevDisabled = compareIso(startOfMonth(focused), min) <= 0;
  const nextDisabled = compareIso(endOfMonth(focused), max) >= 0;

  return (
    <div className="flex flex-col gap-2">
      <ControlGroup controlSize="sm" className="justify-between px-1">
        <Text token="title-small" as="h2" aria-live="polite">
          {monthLabel(focused)}
        </Text>
        <ControlGroup controlSize="sm">
          <Button
            type="button"
            variant="ghost"
            iconOnly
            aria-label="Previous month"
            disabled={prevDisabled}
            onClick={() => {
              step(-1);
            }}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            aria-label="Next month"
            disabled={nextDisabled}
            onClick={() => {
              step(1);
            }}
          >
            <ChevronRight aria-hidden />
          </Button>
        </ControlGroup>
      </ControlGroup>

      <div
        ref={gridRef}
        role="grid"
        aria-label={ariaLabel}
        className="grid grid-cols-7"
        onKeyDown={handleKeyDown}
      >
        <div role="row" className="contents">
          {weekdays.map((label) => (
            <div
              key={label}
              role="columnheader"
              aria-label={label}
              className="text-on-surface-variant text-label-small flex size-10 items-center justify-center"
            >
              {label.slice(0, 2)}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" className="contents" key={week[0]?.iso}>
            {week.map((cell) => {
              const isSelected = cell.iso === value || cell.iso === rangeEnd;
              const isInRange =
                rangeLow !== null &&
                rangeHigh !== null &&
                compareIso(cell.iso, rangeLow) > 0 &&
                compareIso(cell.iso, rangeHigh) < 0;
              const isDisabled = disabled(cell.iso);
              return (
                <div role="gridcell" aria-selected={isSelected} key={cell.iso} className="contents">
                  <button
                    type="button"
                    data-calendar-day={cell.iso}
                    data-selected={isSelected ? '' : undefined}
                    data-today={cell.iso === today ? '' : undefined}
                    tabIndex={cell.iso === focused ? 0 : -1}
                    disabled={isDisabled}
                    aria-label={cell.iso}
                    aria-current={cell.iso === today ? 'date' : undefined}
                    onClick={() => {
                      setFocused(cell.iso);
                      onSelect(cell.iso);
                    }}
                    onFocus={() => {
                      setFocused(cell.iso);
                    }}
                    className={cn(
                      DAY_CELL,
                      focusRing,
                      isSelected
                        ? 'bg-primary text-on-primary'
                        : isInRange
                          ? 'bg-secondary-container text-on-secondary-container'
                          : cell.inMonth
                            ? 'text-on-surface hover:bg-surface-container-highest'
                            : 'text-on-surface-variant hover:bg-surface-container-highest',
                      cell.iso === today && !isSelected ? 'ring-primary ring-1 ring-inset' : '',
                      isDisabled ? 'text-on-surface-variant cursor-not-allowed opacity-40' : '',
                    )}
                  >
                    {cell.day}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
