import type { ProcessTrigger, RecurrenceSeriesDetailOut } from '@/lib/contracts/recurrence';
import { taskRepeatSummary, type TaskRepeatDraft } from './repeat-task-control';

/** Convert a persisted trigger to the editor's task-shaped discriminated value. */
export function repeatDraft(trigger: ProcessTrigger): TaskRepeatDraft | null {
  if (trigger.kind === 'calendar') {
    return {
      kind: 'calendar',
      schedule: trigger.schedule,
      missedPolicy: trigger.missedPolicy,
      materialization: trigger.materialization,
    };
  }
  if (trigger.kind === 'after_completion') {
    return {
      kind: 'after_completion',
      schedule: { kind: 'after_completion', interval: trigger.interval, unit: trigger.unit },
    };
  }
  return null;
}

/** Convert the editor value back to the general persisted process trigger. */
export function processTrigger(value: TaskRepeatDraft): ProcessTrigger | null {
  if (value.kind === 'calendar') {
    return {
      kind: 'calendar',
      schedule: value.schedule,
      missedPolicy: value.missedPolicy,
      materialization: value.materialization,
    };
  }
  if (value.kind === 'after_completion') {
    return {
      kind: 'after_completion',
      interval: value.schedule.interval,
      unit: value.schedule.unit,
    };
  }
  return null;
}

/** Readable trigger copy for schedules not edited by the compact recurrence control. */
export function triggerSummary(trigger: ProcessTrigger): string {
  const editable = repeatDraft(trigger);
  if (editable) return taskRepeatSummary(editable);
  if (trigger.kind === 'manual') return 'Started when you choose';
  return 'Started by a matching event';
}

/** Short, stable civil-date presentation. */
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00.000Z`));
}

/** Return the earliest valid boundary for the next immutable schedule revision. */
export function nextRevisionBoundary(
  today: string,
  revisions: RecurrenceSeriesDetailOut['revisions'],
): string {
  const latest = revisions.reduce<string | null>(
    (result, revision) =>
      result === null || revision.effectiveFrom > result ? revision.effectiveFrom : result,
    null,
  );
  if (latest === null || latest < today) return today;
  const date = new Date(`${latest}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Status label used by occurrence rows. */
export function occurrenceLabel(
  status: RecurrenceSeriesDetailOut['occurrences'][number]['status'],
): string {
  return status === 'needs_resolution'
    ? 'Needs a decision'
    : status === 'materialized'
      ? 'Scheduled'
      : status === 'superseded'
        ? 'Replaced'
        : status.replace('_', ' ');
}
