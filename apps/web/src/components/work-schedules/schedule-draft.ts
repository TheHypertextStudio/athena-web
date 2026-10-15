import type { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkScheduleCreate, type WorkScheduleOut } from '@docket/work/work-schedule-management';
import type { WorkScheduleTrigger } from '@docket/work/work-schedule-trigger';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { ProgramId } from '@docket/work/ids';
import { addCalendarDays } from '@docket/work/calendar-date';
import { renderScheduleTitlePattern } from '@docket/work/schedule-title-pattern';
import {
  createDefaultTaskRepeat,
  taskRepeatSummary,
  type TaskRepeatDraft,
} from '@/components/recurrence/repeat-task-control';

/** Re-enterable local schedule input; an incomplete template selection is never sent to the API. */
export interface ScheduleAuthoringDraft {
  readonly name: string;
  readonly kind: 'task' | 'project';
  readonly document: WorkScheduleDraft | null;
  readonly repeat: TaskRepeatDraft;
  readonly retainedTrigger: WorkScheduleTrigger | null;
  readonly effectiveFrom: string;
  readonly timezone: string;
}

/** Restore a native revision exactly, or start a monthly Project schedule with no implicit template. */
export function initialScheduleDraft(
  today: string,
  timezone: string,
  schedule?: WorkScheduleOut,
): ScheduleAuthoringDraft {
  const document =
    schedule?.revision.document?.kind === 'schedule' ? schedule.revision.document : null;
  const trigger = schedule?.revision.trigger;
  if (!schedule)
    return {
      name: '',
      kind: 'project',
      document: null,
      repeat: createDefaultTaskRepeat('monthly', today, timezone),
      retainedTrigger: null,
      effectiveFrom: today,
      timezone,
    };
  return {
    name: schedule.name,
    kind: document?.root.kind ?? 'project',
    document,
    repeat: repeatFromTrigger(schedule.revision.trigger),
    retainedTrigger: trigger?.kind === 'event' ? trigger : null,
    effectiveFrom: scheduleRevisionMinimumDate(today, schedule),
    timezone: document?.timezone ?? timezone,
  };
}

/** Start a private location draft from a published identity, preserving location fields of the same kind. */
export function selectScheduleTemplate(
  draft: ScheduleAuthoringDraft,
  template: WorkTemplateOut,
  programId: string,
): ScheduleAuthoringDraft {
  if (template.targetType !== 'task' && template.targetType !== 'project') return draft;
  const root =
    draft.document?.root.kind === template.targetType
      ? draft.document.root
      : template.targetType === 'project'
        ? {
            kind: 'project' as const,
            fields: { summary: null, health: null },
            dates: {},
            placement: { programId: ProgramId.parse(programId) },
          }
        : { kind: 'task' as const, fields: { summary: null }, dates: {}, placement: {} };
  return {
    ...draft,
    kind: template.targetType,
    name: draft.name || template.definition.name,
    document: {
      kind: 'schedule',
      revision: 1,
      template: {
        targetType: template.targetType,
        workTypeId: template.id,
        selection: { kind: 'latest' },
      },
      titlePattern:
        draft.document?.titlePattern ??
        ('title' in template.definition.payload
          ? template.definition.payload.title
          : 'name' in template.definition.payload
            ? template.definition.payload.name
            : undefined) ??
        template.definition.name,
      timezone: draft.timezone,
      root,
      optionalChoices: [],
      stepOverrides: [],
    },
  };
}

/** Validate all accepted inputs together before review or persistence. */
export function scheduleCreateInput(
  draft: ScheduleAuthoringDraft,
  programId: string,
): WorkScheduleCreate | null {
  if (!draft.document) return null;
  const parsed = WorkScheduleCreate.safeParse({
    name: draft.name,
    ownerProgramId: programId,
    document: { ...draft.document, timezone: draft.timezone },
    trigger: triggerFromDraft(draft),
    effectiveFrom: draft.effectiveFrom,
  });
  return parsed.success ? parsed.data : null;
}

/** Render the exact civil-date title, returning owned feedback for invalid authored patterns. */
export function scheduleTitleExample(draft: ScheduleAuthoringDraft): string | null {
  if (!draft.document) return null;
  try {
    return renderScheduleTitlePattern(draft.document.titlePattern, draft.effectiveFrom);
  } catch {
    return null;
  }
}

/** A short, explicit cadence summary for review and existing schedules. */
export function scheduleTriggerSummary(trigger: WorkScheduleTrigger): string {
  if (trigger.kind === 'manual') return 'Run when needed';
  if (trigger.kind === 'event') return 'When a matching event occurs';
  return taskRepeatSummary(repeatFromTrigger(trigger));
}

function repeatFromTrigger(trigger: WorkScheduleTrigger): TaskRepeatDraft {
  if (trigger.kind === 'calendar') return trigger;
  if (trigger.kind === 'after_completion') return { kind: 'after_completion', schedule: trigger };
  return { kind: 'none' };
}
function triggerFromDraft(draft: ScheduleAuthoringDraft): WorkScheduleTrigger {
  if (draft.retainedTrigger) return draft.retainedTrigger;
  if (draft.repeat.kind === 'none') return { kind: 'manual' };
  if (draft.repeat.kind === 'after_completion') return draft.repeat.schedule;
  return { ...draft.repeat, schedule: { ...draft.repeat.schedule, timezone: draft.timezone } };
}

/** A new revision starts after the saved boundary and no earlier than the current civil day. */
export function scheduleRevisionMinimumDate(today: string, schedule?: WorkScheduleOut): string {
  if (!schedule) return today;
  const afterSaved = addCalendarDays(schedule.revision.effectiveFrom, 1);
  return afterSaved > today ? afterSaved : today;
}
