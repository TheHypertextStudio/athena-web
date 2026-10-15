import type { recurrenceSeriesRevision } from '@docket/db';
import {
  ProcessTrigger,
  type ProcessTrigger as ProcessTriggerValue,
} from '../../contracts/recurrence';
const WEEKDAY_NUMBER = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
} as const;
/** Fields and selected weekdays persisted for one trigger revision. */
interface TriggerStorage {
  readonly values: Omit<
    typeof recurrenceSeriesRevision.$inferInsert,
    | 'id'
    | 'organizationId'
    | 'seriesId'
    | 'processRevisionId'
    | 'number'
    | 'effectiveFrom'
    | 'createdBy'
  >;
  readonly weekdays: readonly number[];
}

function storageEnd(
  end:
    { kind: 'never' } | { kind: 'on_date'; date: string } | { kind: 'after_count'; count: number },
) {
  if (end.kind === 'never') return { endKind: 'never' as const };
  return end.kind === 'on_date'
    ? { endKind: 'on_date' as const, endDate: end.date }
    : { endKind: 'after_count' as const, endCount: end.count };
}
/** Normalize a trigger union into relational columns and selected weekday rows. */
export function triggerStorage(trigger: ProcessTriggerValue): TriggerStorage {
  const parsed = ProcessTrigger.parse(trigger);
  if (parsed.kind === 'manual') return { values: { triggerKind: 'manual' }, weekdays: [] };
  if (parsed.kind === 'after_completion') {
    return {
      values: {
        triggerKind: 'after_completion',
        interval: parsed.interval,
        intervalUnit: parsed.unit,
      },
      weekdays: [],
    };
  }
  if (parsed.kind === 'event') {
    return {
      values: {
        triggerKind: 'event',
        eventKind: parsed.event.kind,
        eventSubjectType: parsed.event.subjectType,
        eventSource: parsed.event.source,
        eventEntityKind: parsed.event.entityKind,
      },
      weekdays: [],
    };
  }

  const schedule = parsed.schedule;
  const endValues = storageEnd(schedule.end);
  const common = {
    triggerKind: 'calendar' as const,
    scheduleKind: schedule.kind,
    interval: schedule.interval,
    startDate: schedule.startDate,
    timezone: schedule.timezone,
    ...endValues,
    missedPolicy: parsed.missedPolicy,
    horizonDays: parsed.materialization.horizonDays,
    minimumOccurrences: parsed.materialization.minimumOccurrences,
  };
  if (schedule.kind === 'daily') return { values: common, weekdays: [] };
  if (schedule.kind === 'weekly') {
    return {
      values: common,
      weekdays: schedule.weekdays.map((weekday) => WEEKDAY_NUMBER[weekday]),
    };
  }
  if (schedule.kind === 'monthly') {
    return schedule.pattern.kind === 'day_of_month'
      ? {
          values: {
            ...common,
            monthlyPatternKind: 'day_of_month',
            monthDay: schedule.pattern.day,
            overflow: schedule.pattern.overflow,
          },
          weekdays: [],
        }
      : {
          values: {
            ...common,
            monthlyPatternKind: 'nth_weekday',
            nthWeekdayOrdinal: schedule.pattern.ordinal,
            nthWeekday: WEEKDAY_NUMBER[schedule.pattern.weekday],
          },
          weekdays: [],
        };
  }
  return {
    values: {
      ...common,
      yearMonth: schedule.month,
      yearDay: schedule.day,
      overflow: schedule.overflow,
    },
    weekdays: [],
  };
}
