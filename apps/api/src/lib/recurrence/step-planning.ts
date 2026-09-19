/**
 * `@docket/api` — the dates and names a generated work row is stamped with.
 *
 * @remarks
 * A process step says *when* relative to its occurrence rather than *on what date*, and names its
 * work with tokens rather than a literal title, because one revision runs many times. Resolving
 * both is arithmetic over the occurrence's civil date, so it lives here rather than beside the
 * inserts in `./materialize-steps`.
 */
import type { processStep } from '@docket/db';

import { addCalendarDays, parseCalendarDate } from '@docket/planning/calendar-date';

type StepRow = typeof processStep.$inferSelect;

/** Convert a validated calendar date to the timestamp convention used by work rows. */
function planningTimestamp(value: string | null): Date | undefined {
  if (value === null) return undefined;
  parseCalendarDate(value);
  return new Date(`${value}T00:00:00.000Z`);
}

/** Apply stable, intentionally small naming tokens to a generated entity title. */
export function renderName(template: string, scheduledFor: string): string {
  const [year = '', month = ''] = scheduledFor.split('-');
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${year}-${month}-01T00:00:00.000Z`),
  );
  return template
    .replaceAll('{date}', scheduledFor)
    .replaceAll('{year}', year)
    .replaceAll('{month}', month)
    .replaceAll('{monthName}', monthName);
}

/** Resolve a step's planning date from trigger-relative or completion-relative timing. */
export function stepPlanningDate(
  step: StepRow,
  scheduledFor: string,
  completionDates: ReadonlyMap<string, string>,
): string | null {
  if (step.timingKind === 'on_trigger') return scheduledFor;
  if (step.timingKind === 'relative_to_trigger') {
    return addCalendarDays(scheduledFor, step.offsetDays ?? 0);
  }
  const completedOn = step.afterStepId ? completionDates.get(step.afterStepId) : undefined;
  return completedOn ? addCalendarDays(completedOn, step.offsetDays ?? 0) : null;
}

/** Whether completion timing has its required terminal predecessor. */
export function timingReady(step: StepRow, completionDates: ReadonlyMap<string, string>): boolean {
  return (
    step.timingKind !== 'after_step_completion' ||
    (step.afterStepId !== null && completionDates.has(step.afterStepId))
  );
}

/**
 * A planning date the specification offsets from the trigger, or the step's own timing date.
 *
 * @param scheduledFor - The civil date that triggered the occurrence.
 * @param offsetDays - The offset the specification named, when it named one.
 * @param fallback - The date to use when it named no offset.
 * @returns The timestamp for the column, or `undefined` to leave it unset.
 */
export function offsetDate(
  scheduledFor: string,
  offsetDays: number | null,
  fallback: string | null,
): Date | undefined {
  return planningTimestamp(
    offsetDays === null ? fallback : addCalendarDays(scheduledFor, offsetDays),
  );
}

/** The terminal timestamp a generated task carries when its state is already an ending one. */
export function terminalStamp(
  category: string,
  at: Date,
): { completedAt?: Date } | { canceledAt?: Date } | Record<string, never> {
  if (category === 'completed') return { completedAt: at };
  if (category === 'canceled') return { canceledAt: at };
  return {};
}
