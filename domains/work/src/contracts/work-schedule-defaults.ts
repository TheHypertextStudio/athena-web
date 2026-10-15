import { z } from 'zod';
import { addCalendarDays, calendarDaysBetween } from '../calendar-date';
import { ScheduleTitlePattern } from '../schedule-title-pattern';
import {
  BlueprintCivilDate,
  BlueprintStep,
  StepKey,
  type BlueprintWarningCode,
} from './work-template-blueprint';
import {
  AfterCountEnd,
  CalendarRecurrenceSchedule,
  DailySchedule,
  MonthlySchedule,
  NeverEnd,
  WeeklySchedule,
  YearlySchedule,
} from './recurrence';
/** Relative reusable end condition; literal calendar end dates belong to the private schedule copy. */
export const RelativeRecurrenceEnd = z.discriminatedUnion('kind', [NeverEnd, AfterCountEnd]);
/** Reusable recurrence end value. */
export type RelativeRecurrenceEnd = z.infer<typeof RelativeRecurrenceEnd>;
const relativeFields = {
  startOffsetDays: z.number().int().min(-36500).max(36500).default(0),
  end: RelativeRecurrenceEnd.default({ kind: 'never' }),
};
const absoluteFields = { startDate: true, timezone: true, end: true } as const;
/** Reusable calendar cadence anchored to Program creation, with no absolute dates or timezone. */
export const RelativeCalendarRecurrenceSchedule = z.discriminatedUnion('kind', [
  DailySchedule.omit(absoluteFields).extend(relativeFields),
  WeeklySchedule.omit(absoluteFields).extend(relativeFields),
  MonthlySchedule.omit(absoluteFields).extend(relativeFields),
  YearlySchedule.omit(absoluteFields).extend(relativeFields),
]);
/** Relative calendar cadence value. */
export type RelativeCalendarRecurrenceSchedule = z.infer<typeof RelativeCalendarRecurrenceSchedule>;
const taskStep = BlueprintStep.options[0];
/** Task or Project publication selection, reusing the blueprint's exact latest/pinned vocabulary. */
export const ScheduleTemplateSelection = taskStep.shape.template
  .unwrap()
  .extend({ targetType: z.enum(['task', 'project']) });
/** Exact reusable schedule publication selection value. */
export type ScheduleTemplateSelection = z.infer<typeof ScheduleTemplateSelection>;
/** Reusable independent Program schedule outline; all literal location facts belong to its instantiated copy. */
export const ProgramDefaultSchedule = z.strictObject({
  key: StepKey,
  name: z
    .string()
    .min(1)
    .max(120)
    .refine((value) => value.trim().length > 0, 'Name the schedule.'),
  template: ScheduleTemplateSelection,
  titlePattern: ScheduleTitlePattern,
  cadence: RelativeCalendarRecurrenceSchedule,
  teamRule: taskStep.shape.teamRule,
  actorRule: taskStep.shape.actorRule,
});
/** Reusable Program schedule outline value. */
export type ProgramDefaultSchedule = z.infer<typeof ProgramDefaultSchedule>;
/** Bounded independent Program defaults with stable unique authoring keys. */
export const ProgramDefaultSchedules = z
  .array(ProgramDefaultSchedule)
  .max(20)
  .refine(
    (values) => new Set(values.map((value) => value.key)).size === values.length,
    'Schedule keys must be unique.',
  );
/** Program default schedule collection value. */
export type ProgramDefaultSchedules = z.infer<typeof ProgramDefaultSchedules>;
/** Concrete civil creation context supplied when installing a Program's independent schedule copy. */
export interface RelativeCadenceContext {
  readonly creationDate: string;
  readonly timezone: string;
}
/** Resolve relative start with the shared calendar arithmetic and existing absolute cadence validator. */
export function instantiateRelativeCadence(
  cadence: RelativeCalendarRecurrenceSchedule,
  context: RelativeCadenceContext,
): CalendarRecurrenceSchedule {
  const { startOffsetDays, ...fields } = RelativeCalendarRecurrenceSchedule.parse(cadence);
  const startDate = BlueprintCivilDate.parse(
    addCalendarDays(BlueprintCivilDate.parse(context.creationDate), startOffsetDays),
  );
  return CalendarRecurrenceSchedule.parse({ ...fields, startDate, timezone: context.timezone });
}

/** Actual Program assignment context, never a reusable person or team literal. */
export interface DefaultScheduleParent {
  readonly teamId: string | null;
  readonly responsibleActorId: string | null;
}
/** Authorized creation context used to resolve reusable parent assignment rules. */
export interface DefaultScheduleCopyContext extends RelativeCadenceContext {
  readonly creationTeamId: string | null;
  readonly initiatingActorId: string | null;
  readonly athenaActorId: string | null;
}
/** Concrete independent cadence and root assignment, ready for ordinary schedule preflight. */
export function instantiateDefaultScheduleCopy(
  outline: ProgramDefaultSchedule,
  parent: DefaultScheduleParent,
  context: DefaultScheduleCopyContext,
): {
  cadence: CalendarRecurrenceSchedule;
  root: {
    kind: 'task' | 'project';
    fields: Record<string, never>;
    dates: Record<string, never>;
    placement: Record<string, never>;
    teamId: string | null;
    responsibleActorId: string | null;
  };
} {
  const teamId =
    outline.teamRule === 'parent_team'
      ? parent.teamId
      : outline.teamRule === 'creation_team'
        ? context.creationTeamId
        : null;
  const responsibleActorId =
    outline.actorRule === 'parent_responsible'
      ? parent.responsibleActorId
      : outline.actorRule === 'creator'
        ? context.initiatingActorId
        : outline.actorRule === 'athena'
          ? context.athenaActorId
          : null;
  return {
    cadence: instantiateRelativeCadence(outline.cadence, context),
    root: {
      kind: outline.template.targetType,
      fields: {},
      dates: {},
      placement: {},
      teamId,
      responsibleActorId,
    },
  };
}

/** Authorized private source facts for a reusable outline; private values are never returned. */
export interface DefaultScheduleCaptureInput {
  readonly key: string;
  readonly name: string;
  readonly template: ScheduleTemplateSelection;
  readonly titlePattern: string;
  readonly cadence: CalendarRecurrenceSchedule;
  readonly creationDate: string;
  readonly parent: DefaultScheduleParent;
  readonly root: DefaultScheduleParent;
  readonly hasPrivateAssignments: boolean;
  readonly hasPrivateDraft: boolean;
  readonly providerBound: boolean;
}
/** Capture a relative outline and explain each omitted location-specific responsibility or binding. */
export function captureDefaultScheduleOutline(input: DefaultScheduleCaptureInput): {
  outline: ProgramDefaultSchedule;
  warnings: BlueprintWarningCode[];
} {
  const warnings: BlueprintWarningCode[] = [];
  const teamRule =
    input.root.teamId !== null && input.root.teamId === input.parent.teamId
      ? 'parent_team'
      : 'none';
  const actorRule =
    input.root.responsibleActorId !== null &&
    input.root.responsibleActorId === input.parent.responsibleActorId
      ? 'parent_responsible'
      : 'unassigned';
  if (omitsPrivateAssignments(input, teamRule, actorRule))
    warnings.push('capture_schedule_assignment');
  if (input.hasPrivateDraft) warnings.push('capture_schedule_draft');
  if (input.providerBound) warnings.push('capture_schedule_provider');
  const { startDate, timezone: _timezone, ...cadence } = input.cadence;
  if (cadence.end.kind === 'on_date') warnings.push('capture_schedule_cadence');
  return {
    outline: ProgramDefaultSchedule.parse({
      key: input.key,
      name: input.name,
      template: input.template,
      titlePattern: input.titlePattern,
      cadence: {
        ...cadence,
        end: cadence.end.kind === 'on_date' ? { kind: 'never' } : cadence.end,
        startOffsetDays: calendarDaysBetween(input.creationDate, startDate),
      },
      teamRule,
      actorRule,
    }),
    warnings,
  };
}

function omitsPrivateAssignments(
  input: DefaultScheduleCaptureInput,
  teamRule: ProgramDefaultSchedule['teamRule'],
  actorRule: ProgramDefaultSchedule['actorRule'],
): boolean {
  return (
    input.hasPrivateAssignments ||
    (teamRule === 'none' && input.root.teamId !== null) ||
    (actorRule === 'unassigned' && input.root.responsibleActorId !== null)
  );
}
