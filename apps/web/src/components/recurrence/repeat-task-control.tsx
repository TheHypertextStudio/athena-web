'use client';

/** Product-native repeat property and editor for the ordinary task composer. */
import type {
  AfterCompletionSchedule,
  CalendarRecurrenceSchedule,
  MissedOccurrencePolicy,
  RecurrenceEnd,
  RecurrenceWeekday,
} from '../../lib/contracts/recurrence';
import { PropertyTrigger } from '@docket/ui/components';
import { RefreshCw } from '@docket/ui/icons';
import {
  Button,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
  Select,
  Surface,
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import type { RelativeCalendarRecurrenceSchedule } from '@docket/work/work-schedule-defaults';
import { DatePicker } from '@/components/date-picker';
import { RepeatWeekdaySelection } from './repeat-weekday-selection';
import { RepeatCalendarPattern, monthlyPatternSummary } from './repeat-calendar-pattern';

/** A task that will be created once. */
export interface NonRepeatingTaskDraft {
  readonly kind: 'none';
}

/** A task repeated from stable civil-calendar dates. */
export interface CalendarTaskRepeatDraft {
  readonly kind: 'calendar';
  readonly schedule: CalendarRecurrenceSchedule;
  readonly missedPolicy: MissedOccurrencePolicy;
  readonly materialization: { readonly horizonDays: number; readonly minimumOccurrences: number };
}

/** A task whose next copy is released from actual completion. */
export interface CompletionTaskRepeatDraft {
  readonly kind: 'after_completion';
  readonly schedule: AfterCompletionSchedule;
}

/** The composer's discriminated repeat value. */
export type TaskRepeatDraft =
  NonRepeatingTaskDraft | CalendarTaskRepeatDraft | CompletionTaskRepeatDraft;

/** Cadences directly authorable from the ordinary task composer. */
export type TaskRepeatCadence = CalendarRecurrenceSchedule['kind'] | 'after_completion';

/** Props for {@link RepeatTaskControl}. */
export interface RepeatTaskControlProps {
  readonly value: TaskRepeatDraft;
  readonly onChange: (value: TaskRepeatDraft) => void;
  readonly today: string;
  readonly timezone: string;
  readonly disabled?: boolean;
  /** Show fields directly in a setup step instead of behind a property popover. */
  readonly presentation?: 'popover' | 'inline';
  /** Workspace vocabulary for the work being repeated. */
  readonly workNoun?: string;
}

const WEEKDAYS: readonly { value: RecurrenceWeekday; short: string; label: string }[] = [
  { value: 'monday', short: 'M', label: 'Monday' },
  { value: 'tuesday', short: 'T', label: 'Tuesday' },
  { value: 'wednesday', short: 'W', label: 'Wednesday' },
  { value: 'thursday', short: 'T', label: 'Thursday' },
  { value: 'friday', short: 'F', label: 'Friday' },
  { value: 'saturday', short: 'S', label: 'Saturday' },
  { value: 'sunday', short: 'S', label: 'Sunday' },
] as const;

const SHORT_WEEKDAY: Readonly<Record<RecurrenceWeekday, string>> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

/** Resolve a calendar date's weekday without allowing the browser timezone to shift its day. */
function weekdayFor(date: string): RecurrenceWeekday {
  const index = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return WEEKDAYS[(index + 6) % 7]?.value ?? 'monday';
}

/** Extract the numeric month and day from a valid ISO date. */
function monthDay(date: string): { month: number; day: number } {
  const [, month = '1', day = '1'] = date.split('-');
  return { month: Number(month), day: Number(day) };
}

/** Build the intuitive defaults for a newly selected cadence. */
export function createDefaultTaskRepeat(
  cadence: TaskRepeatCadence,
  startDate: string,
  timezone: string,
): Exclude<TaskRepeatDraft, NonRepeatingTaskDraft> {
  if (cadence === 'after_completion') {
    return {
      kind: 'after_completion',
      schedule: { kind: 'after_completion', interval: 1, unit: 'day' },
    };
  }
  const common = { interval: 1, startDate, timezone, end: { kind: 'never' } as const };
  const schedule: CalendarRecurrenceSchedule =
    cadence === 'daily'
      ? { kind: 'daily', ...common }
      : cadence === 'weekly'
        ? { kind: 'weekly', ...common, weekdays: [weekdayFor(startDate)] }
        : cadence === 'monthly'
          ? {
              kind: 'monthly',
              ...common,
              pattern: { kind: 'day_of_month', day: monthDay(startDate).day, overflow: 'last_day' },
            }
          : { kind: 'yearly', ...common, ...monthDay(startDate), overflow: 'last_day' };
  return {
    kind: 'calendar',
    schedule,
    missedPolicy: 'skip',
    materialization: { horizonDays: 28, minimumOccurrences: 2 },
  };
}

/** Turn a repeat rule into the short sentence shown on its property pill. */
export function taskRepeatSummary(value: TaskRepeatDraft): string {
  if (value.kind === 'none') return 'Does not repeat';
  const { schedule } = value;
  if (schedule.kind === 'after_completion') {
    const unit = schedule.interval === 1 ? schedule.unit : `${schedule.unit}s`;
    return `${schedule.interval} ${unit} after completion`;
  }
  return calendarRecurrenceSummary(schedule);
}
/** Describe a calendar cadence independently of its absolute or relative starting context. */
export function calendarRecurrenceSummary(
  schedule: CalendarRecurrenceSchedule | RelativeCalendarRecurrenceSchedule,
): string {
  const interval = schedule.interval;
  if (schedule.kind === 'daily') return interval === 1 ? 'Every day' : `Every ${interval} days`;
  if (schedule.kind === 'weekly') {
    const days = new Intl.ListFormat('en', { style: 'short', type: 'conjunction' }).format(
      schedule.weekdays.map((day) => SHORT_WEEKDAY[day]),
    );
    return `${interval === 1 ? 'Every week' : `Every ${interval} weeks`} on ${days}`;
  }
  if (schedule.kind === 'monthly') {
    const cadence = interval === 1 ? 'Every month' : `Every ${interval} months`;
    return `${cadence} on ${monthlyPatternSummary(schedule.pattern)}`;
  }
  const date = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(
    new Date(
      `2024-${String(schedule.month).padStart(2, '0')}-${String(schedule.day).padStart(2, '0')}T12:00:00.000Z`,
    ),
  );
  return `${interval === 1 ? 'Every year' : `Every ${interval} years`} on ${date}`;
}

/** Replace the end condition while preserving the narrowed calendar schedule arm. */
function withEnd(
  schedule: CalendarRecurrenceSchedule,
  end: RecurrenceEnd,
): CalendarRecurrenceSchedule {
  return { ...schedule, end };
}

/** Replace the interval while preserving the narrowed schedule arm. */
function withInterval(
  schedule: CalendarRecurrenceSchedule,
  interval: number,
): CalendarRecurrenceSchedule {
  return { ...schedule, interval };
}

function calendarIntervalUnit(schedule: CalendarRecurrenceSchedule): string {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[schedule.kind];
  return schedule.interval === 1 ? unit : `${unit}s`;
}

/** Edit repeat settings directly in setup flows or through the ordinary property popover. */
export function RepeatTaskControl(props: RepeatTaskControlProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { value, disabled = false, workNoun = 'task', presentation = 'popover' } = props;
  if (presentation === 'inline') return <RepeatFields {...props} />;
  const summary = taskRepeatSummary(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <PropertyTrigger
          variant="secondary"
          icon={<RefreshCw className="size-4" />}
          label={value.kind === 'none' ? undefined : summary}
          placeholder="Repeat"
          ariaLabel={`Repeat — ${summary}`}
          disabled={disabled}
        />
      </PopoverTrigger>
      <PopoverContent presentation="panel" width="xl" align="start">
        <PopoverHeader>
          <h2 className="text-title-small text-on-surface">Repeat {workNoun.toLowerCase()}</h2>
          <p className="text-body-small text-on-surface-variant mt-0.5">
            Choose a calendar schedule or repeat after completion.
          </p>
        </PopoverHeader>
        <PopoverBody>
          <RepeatFields {...props} />
        </PopoverBody>
        <PopoverFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setOpen(false);
            }}
          >
            Done
          </Button>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  );
}

function RepeatFields({
  value,
  onChange,
  today,
  timezone,
  disabled = false,
}: RepeatTaskControlProps): JSX.Element {
  const [showOptions, setShowOptions] = useState(false);
  const cadence = value.kind === 'calendar' ? value.schedule.kind : value.kind;
  const updateCalendar = (next: CalendarRecurrenceSchedule): void => {
    if (value.kind === 'calendar') onChange({ ...value, schedule: next });
  };
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4">
      <label className="text-label-medium text-on-surface flex flex-col gap-1.5">
        Repeats
        <Select
          aria-label="Repeat cadence"
          value={cadence}
          onChange={(event) => {
            const next = event.target.value;
            onChange(
              next === 'none'
                ? { kind: 'none' }
                : createDefaultTaskRepeat(next as TaskRepeatCadence, today, timezone),
            );
          }}
        >
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="after_completion">After completion</option>
        </Select>
      </label>

      {value.kind === 'calendar' ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <div className="flex flex-col gap-1.5">
              <span className="text-label-medium text-on-surface">Starts</span>
              <DatePicker
                value={value.schedule.startDate}
                onChange={(next) => {
                  if (next) updateCalendar({ ...value.schedule, startDate: next });
                }}
                placeholder="Choose a start date"
                ariaLabel="Repeat start date"
                disabled={disabled}
                triggerVariant="secondary"
                triggerClassName="w-full justify-between"
              />
            </div>
            <label className="text-label-medium text-on-surface flex flex-col gap-1.5">
              Every
              <span className="flex items-center gap-2">
                <Input
                  className="w-16"
                  type="number"
                  aria-label="Repeat interval"
                  min={1}
                  value={value.schedule.interval}
                  onChange={(event) => {
                    updateCalendar(
                      withInterval(value.schedule, Math.max(1, Number(event.target.value))),
                    );
                  }}
                />
                <span className="text-body-medium">{calendarIntervalUnit(value.schedule)}</span>
              </span>
            </label>
          </div>

          {value.schedule.kind === 'weekly' ? (
            <RepeatWeekdays
              value={{ ...value, schedule: value.schedule }}
              updateCalendar={updateCalendar}
            />
          ) : null}

          <RepeatCalendarPattern schedule={value.schedule} onChange={updateCalendar} />

          <RepeatEnd value={value} updateCalendar={updateCalendar} disabled={disabled} />

          {showOptions ? <RepeatOptions value={value} onChange={onChange} /> : null}
        </>
      ) : null}

      {value.kind === 'after_completion' ? (
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
          <label className="text-label-medium text-on-surface flex flex-col gap-1.5">
            Wait
            <Input
              type="number"
              aria-label="Wait after completion"
              min={1}
              value={value.schedule.interval}
              onChange={(event) => {
                onChange({
                  kind: 'after_completion',
                  schedule: {
                    ...value.schedule,
                    interval: Math.max(1, Number(event.target.value)),
                  },
                });
              }}
            />
          </label>
          <label className="text-label-medium text-on-surface flex flex-col gap-1.5">
            Unit
            <Select
              aria-label="Completion interval unit"
              value={value.schedule.unit}
              onChange={(event) => {
                onChange({
                  kind: 'after_completion',
                  schedule: {
                    ...value.schedule,
                    unit: event.target.value as AfterCompletionSchedule['unit'],
                  },
                });
              }}
            >
              <option value="day">Days</option>
              <option value="week">Weeks</option>
              <option value="month">Months</option>
            </Select>
          </label>
        </div>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => {
          setShowOptions((current) => !current);
        }}
        disabled={disabled || value.kind !== 'calendar'}
      >
        {showOptions ? 'Fewer options' : 'More options'}
      </Button>
    </fieldset>
  );
}

interface CalendarFieldsProps {
  readonly value: CalendarTaskRepeatDraft;
  readonly updateCalendar: (next: CalendarRecurrenceSchedule) => void;
  readonly disabled?: boolean;
}

function RepeatWeekdays({
  value,
  updateCalendar,
}: {
  readonly value: CalendarTaskRepeatDraft & {
    readonly schedule: Extract<CalendarRecurrenceSchedule, { kind: 'weekly' }>;
  };
  readonly updateCalendar: (value: CalendarRecurrenceSchedule) => void;
}): JSX.Element {
  return (
    <RepeatWeekdaySelection
      value={value.schedule.weekdays}
      onChange={(weekdays) => {
        updateCalendar({ ...value.schedule, weekdays });
      }}
    />
  );
}

function RepeatEnd({ value, updateCalendar, disabled }: CalendarFieldsProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="text-label-medium text-on-surface flex flex-col gap-1.5">
        Ends
        <Select
          aria-label="Repeat ends"
          value={value.schedule.end.kind}
          onChange={(event) => {
            const kind = event.target.value;
            const end: RecurrenceEnd =
              kind === 'on_date'
                ? { kind: 'on_date', date: value.schedule.startDate }
                : kind === 'after_count'
                  ? { kind: 'after_count', count: 10 }
                  : { kind: 'never' };
            updateCalendar(withEnd(value.schedule, end));
          }}
        >
          <option value="never">Never</option>
          <option value="on_date">On date</option>
          <option value="after_count">After occurrences</option>
        </Select>
      </label>
      {value.schedule.end.kind === 'on_date' ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-label-medium text-on-surface">End date</span>
          <DatePicker
            min={value.schedule.startDate}
            value={value.schedule.end.date}
            onChange={(next) => {
              if (next) {
                updateCalendar(withEnd(value.schedule, { kind: 'on_date', date: next }));
              }
            }}
            placeholder="Choose an end date"
            ariaLabel="Repeat end date"
            disabled={disabled}
            triggerVariant="secondary"
            triggerClassName="w-full justify-between"
          />
        </div>
      ) : null}
      {value.schedule.end.kind === 'after_count' ? (
        <label className="text-label-medium text-on-surface flex flex-col gap-1.5">
          Occurrences
          <Input
            type="number"
            aria-label="Number of occurrences"
            min={1}
            value={value.schedule.end.count}
            onChange={(event) => {
              updateCalendar(
                withEnd(value.schedule, {
                  kind: 'after_count',
                  count: Math.max(1, Number(event.target.value)),
                }),
              );
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

function RepeatOptions({
  value,
  onChange,
}: {
  readonly value: CalendarTaskRepeatDraft;
  readonly onChange: (next: TaskRepeatDraft) => void;
}): JSX.Element {
  return (
    <Surface tone="card" shape="medium" pad="comfortable" className="flex flex-col gap-3">
      <label className="text-label-medium text-on-surface flex flex-col gap-1.5">
        When an occurrence is missed
        <Select
          aria-label="When an occurrence is missed"
          value={value.missedPolicy}
          onChange={(event) => {
            onChange({
              ...value,
              missedPolicy: event.target.value as MissedOccurrencePolicy,
            });
          }}
        >
          <option value="skip">Mark it skipped</option>
          <option value="carry">Keep it overdue</option>
          <option value="resolve">Ask what to do</option>
        </Select>
      </label>
      <label className="text-label-medium text-on-surface flex flex-col gap-1.5">
        Schedule ahead
        <Select
          aria-label="Schedule ahead"
          value={value.materialization.horizonDays}
          onChange={(event) => {
            onChange({
              ...value,
              materialization: {
                ...value.materialization,
                horizonDays: Number(event.target.value),
              },
            });
          }}
        >
          <option value={14}>2 weeks</option>
          <option value={28}>4 weeks</option>
          <option value={56}>8 weeks</option>
        </Select>
      </label>
    </Surface>
  );
}
