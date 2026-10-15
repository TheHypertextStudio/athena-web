/** Browser-independent cadence contracts, shared by native schedules and compatibility adapters. */
import { z } from 'zod';

/** A weekday in an explicit, locale-independent recurrence rule. */
export const RecurrenceWeekday = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);
/** Recurrence weekday value. */
export type RecurrenceWeekday = z.infer<typeof RecurrenceWeekday>;

/** A series with no configured end. */
export const NeverEnd = z.object({ kind: z.literal('never') }).strict();
/** Never-ending recurrence value. */
export type NeverEnd = z.infer<typeof NeverEnd>;

/** A series ending on an inclusive calendar date. */
export const OnDateEnd = z.object({ kind: z.literal('on_date'), date: z.iso.date() }).strict();
/** Date-ending recurrence value. */
export type OnDateEnd = z.infer<typeof OnDateEnd>;

/** A series ending after a fixed number of expected occurrences. */
export const AfterCountEnd = z
  .object({ kind: z.literal('after_count'), count: z.number().int().positive() })
  .strict();
/** Count-ending recurrence value. */
export type AfterCountEnd = z.infer<typeof AfterCountEnd>;

/** How a calendar recurrence stops. */
export const RecurrenceEnd = z.discriminatedUnion('kind', [NeverEnd, OnDateEnd, AfterCountEnd]);
/** Recurrence end value. */
export type RecurrenceEnd = z.infer<typeof RecurrenceEnd>;

const CalendarScheduleFields = {
  interval: z.number().int().positive().default(1),
  startDate: z.iso.date(),
  timezone: z.string().min(1),
  end: RecurrenceEnd.default({ kind: 'never' }),
} as const;

/** A calendar schedule occurring every N days. */
export const DailySchedule = z
  .object({ kind: z.literal('daily'), ...CalendarScheduleFields })
  .strict();
/** Daily schedule value. */
export type DailySchedule = z.infer<typeof DailySchedule>;

/** Nonempty recurrence weekdays retaining authored order and rejecting duplicate entries. */
export const RecurrenceWeekdays = z
  .array(RecurrenceWeekday)
  .min(1)
  .superRefine((value, ctx) => {
    if (new Set(value).size !== value.length)
      ctx.addIssue({ code: 'custom', message: 'Weekdays must be unique' });
  });
/** Valid distinct recurrence weekdays. */
export type RecurrenceWeekdays = z.infer<typeof RecurrenceWeekdays>;

/** A calendar schedule occurring on one or more weekdays every N weeks. */
export const WeeklySchedule = z
  .object({ kind: z.literal('weekly'), ...CalendarScheduleFields, weekdays: RecurrenceWeekdays })
  .strict();
/** Weekly schedule value. */
export type WeeklySchedule = z.infer<typeof WeeklySchedule>;

/** What to do when a numbered day does not exist in a month or year. */
export const CalendarOverflow = z.enum(['skip', 'last_day']);
/** Calendar overflow value. */
export type CalendarOverflow = z.infer<typeof CalendarOverflow>;

/** A monthly pattern targeting a numbered day. */
export const DayOfMonthPattern = z
  .object({
    kind: z.literal('day_of_month'),
    day: z.number().int().min(1).max(31),
    overflow: CalendarOverflow.default('skip'),
  })
  .strict();
/** Day-of-month pattern value. */
export type DayOfMonthPattern = z.infer<typeof DayOfMonthPattern>;

/** A monthly pattern targeting the first-through-fifth or last weekday. */
export const NthWeekdayPattern = z
  .object({
    kind: z.literal('nth_weekday'),
    ordinal: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(-1),
    ]),
    weekday: RecurrenceWeekday,
  })
  .strict();
/** Nth-weekday pattern value. */
export type NthWeekdayPattern = z.infer<typeof NthWeekdayPattern>;

/** The calendar pattern within a monthly schedule. */
export const MonthlyPattern = z.discriminatedUnion('kind', [DayOfMonthPattern, NthWeekdayPattern]);
/** Monthly pattern value. */
export type MonthlyPattern = z.infer<typeof MonthlyPattern>;

/** A calendar schedule occurring every N months. */
export const MonthlySchedule = z
  .object({ kind: z.literal('monthly'), ...CalendarScheduleFields, pattern: MonthlyPattern })
  .strict();
/** Monthly schedule value. */
export type MonthlySchedule = z.infer<typeof MonthlySchedule>;

/** A calendar schedule occurring every N years on a month and day. */
export const YearlySchedule = z
  .object({
    kind: z.literal('yearly'),
    ...CalendarScheduleFields,
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    overflow: CalendarOverflow.default('skip'),
  })
  .strict();
/** Yearly schedule value. */
export type YearlySchedule = z.infer<typeof YearlySchedule>;

/** A schedule whose next occurrence is anchored to the prior task's actual completion. */
export const AfterCompletionSchedule = z
  .object({
    kind: z.literal('after_completion'),
    interval: z.number().int().positive(),
    unit: z.enum(['day', 'week', 'month']),
  })
  .strict();
/** Completion-anchored schedule value. */
export type AfterCompletionSchedule = z.infer<typeof AfterCompletionSchedule>;

/** Calendar-driven schedule arms. */
export const CalendarRecurrenceSchedule = z.discriminatedUnion('kind', [
  DailySchedule,
  WeeklySchedule,
  MonthlySchedule,
  YearlySchedule,
]);
/** Calendar recurrence schedule value. */
export type CalendarRecurrenceSchedule = z.infer<typeof CalendarRecurrenceSchedule>;

/** Any schedule Docket can execute, discriminated by `kind`. */
export const RecurrenceSchedule = z.union([CalendarRecurrenceSchedule, AfterCompletionSchedule]);
/** Recurrence schedule value. */
export type RecurrenceSchedule = z.infer<typeof RecurrenceSchedule>;

/** Calendar behavior when an expected occurrence passes unfinished. */
export const MissedOccurrencePolicy = z.enum(['skip', 'carry', 'resolve']);
/** Missed-occurrence policy value. */
export type MissedOccurrencePolicy = z.infer<typeof MissedOccurrencePolicy>;

/** Rolling materialization policy used to make scheduled work visible to planning. */
export const MaterializationPolicy = z
  .object({
    horizonDays: z.number().int().min(1).max(366).default(28),
    minimumOccurrences: z.number().int().min(1).max(100).default(2),
  })
  .strict();
/** Materialization policy value. */
export type MaterializationPolicy = z.infer<typeof MaterializationPolicy>;
