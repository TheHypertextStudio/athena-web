'use client';
import type { JSX } from 'react';
import type {
  CalendarRecurrenceSchedule,
  MonthlyPattern,
  RecurrenceWeekday,
} from '@docket/work/recurrence';
import { Input, Select } from '@docket/ui/primitives';

const WEEKDAYS: readonly RecurrenceWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
const ORDINALS = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: 5, label: 'Fifth' },
  { value: -1, label: 'Last' },
] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const labelClass = 'text-label-medium text-on-surface flex min-w-0 flex-col gap-1.5';

/** Describe the exact monthly pattern, including its ordinal weekday. */
export function monthlyPatternSummary(pattern: MonthlyPattern): string {
  if (pattern.kind === 'day_of_month') return `day ${pattern.day}`;
  const ordinal =
    ORDINALS.find((item) => item.value === pattern.ordinal)?.label.toLowerCase() ?? '';
  return `the ${ordinal} ${pattern.weekday[0]?.toUpperCase()}${pattern.weekday.slice(1)}`;
}

/** Shared repeat controls for monthly weekday patterns and yearly calendar dates. */
export function RepeatCalendarPattern({
  schedule,
  onChange,
}: {
  readonly schedule: CalendarRecurrenceSchedule;
  readonly onChange: (schedule: CalendarRecurrenceSchedule) => void;
}): JSX.Element | null {
  if (schedule.kind === 'monthly')
    return (
      <MonthlyRepeatPattern
        value={schedule.pattern}
        onChange={(pattern) => {
          onChange({ ...schedule, pattern });
        }}
      />
    );
  if (schedule.kind !== 'yearly') return null;
  return (
    <YearlyRepeatPattern
      value={schedule}
      onChange={(next) => {
        onChange({ ...schedule, ...next });
      }}
    />
  );
}
/** Yearly month/day/overflow fields shared by absolute and reusable relative cadence. */
export function YearlyRepeatPattern({
  value: schedule,
  onChange,
}: {
  readonly value: Pick<
    Extract<CalendarRecurrenceSchedule, { kind: 'yearly' }>,
    'month' | 'day' | 'overflow'
  >;
  readonly onChange: (
    value: Pick<
      Extract<CalendarRecurrenceSchedule, { kind: 'yearly' }>,
      'month' | 'day' | 'overflow'
    >,
  ) => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
        <label className={labelClass}>
          Month
          <Select
            aria-label="Repeat month"
            value={schedule.month}
            onChange={(event) => {
              onChange({ ...schedule, month: Number(event.target.value) });
            }}
          >
            {MONTHS.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </Select>
        </label>
        <label className={labelClass}>
          Day
          <Input
            aria-label="Repeat day"
            type="number"
            min={1}
            max={31}
            value={schedule.day}
            onChange={(event) => {
              onChange({ ...schedule, day: Number(event.target.value) });
            }}
          />
        </label>
      </div>
      <OverflowField
        value={schedule.overflow}
        onChange={(overflow) => {
          onChange({ ...schedule, overflow });
        }}
      />
    </div>
  );
}

/** Monthly day or ordinal-weekday fields shared without introducing a concrete start date. */
export function MonthlyRepeatPattern({
  value: pattern,
  onChange: change,
}: {
  readonly value: MonthlyPattern;
  readonly onChange: (pattern: MonthlyPattern) => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <label className={labelClass}>
        On
        <Select
          aria-label="Monthly repeat pattern"
          value={pattern.kind}
          onChange={(event) => {
            change(
              event.target.value === 'nth_weekday'
                ? { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' }
                : { kind: 'day_of_month', day: 1, overflow: 'last_day' },
            );
          }}
        >
          <option value="day_of_month">A day of the month</option>
          <option value="nth_weekday">A weekday of the month</option>
        </Select>
      </label>
      {pattern.kind === 'nth_weekday' ? (
        <MonthlyWeekdayFields pattern={pattern} onChange={change} />
      ) : (
        <>
          <label className={labelClass}>
            Day
            <Input
              aria-label="Monthly day"
              type="number"
              min={1}
              max={31}
              value={pattern.day}
              onChange={(event) => {
                change({ ...pattern, day: Number(event.target.value) });
              }}
            />
          </label>
          <OverflowField
            value={pattern.overflow}
            onChange={(overflow) => {
              change({ ...pattern, overflow });
            }}
          />
        </>
      )}
    </div>
  );
}

function OverflowField({
  value,
  onChange,
}: {
  readonly value: 'skip' | 'last_day';
  readonly onChange: (value: 'skip' | 'last_day') => void;
}): JSX.Element {
  return (
    <label className={labelClass}>
      If that date does not exist
      <Select
        aria-label="Short month behavior"
        value={value}
        onChange={(event) => {
          onChange(event.target.value as 'skip' | 'last_day');
        }}
      >
        <option value="last_day">Use the last day</option>
        <option value="skip">Skip that occurrence</option>
      </Select>
    </label>
  );
}

function MonthlyWeekdayFields({
  pattern,
  onChange,
}: {
  readonly pattern: Extract<MonthlyPattern, { kind: 'nth_weekday' }>;
  readonly onChange: (pattern: MonthlyPattern) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className={labelClass}>
        Which
        <Select
          aria-label="Monthly weekday position"
          value={pattern.ordinal}
          onChange={(event) => {
            onChange({
              ...pattern,
              ordinal: Number(event.target.value) as typeof pattern.ordinal,
            });
          }}
        >
          {ORDINALS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </label>
      <label className={labelClass}>
        Weekday
        <Select
          aria-label="Monthly weekday"
          value={pattern.weekday}
          onChange={(event) => {
            onChange({ ...pattern, weekday: event.target.value as RecurrenceWeekday });
          }}
        >
          {WEEKDAYS.map((day) => (
            <option key={day} value={day}>
              {day[0]?.toUpperCase()}
              {day.slice(1)}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
