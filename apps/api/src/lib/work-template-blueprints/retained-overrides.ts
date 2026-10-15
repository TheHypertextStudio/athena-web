import type { BlueprintInvocationOverride, BlueprintInvocationStep } from '@docket/db';
import { ActorId, TeamId } from '@docket/identity-access/ids';
import { CycleId } from '@docket/work/ids';
import { addCalendarDays } from '@docket/work/calendar-date';
import type {
  BlueprintNodeOverride,
  BlueprintPlacement,
  ResolvedBlueprintFields,
} from '@docket/work/blueprints';
import { CanonicalTemplateDraft } from '@docket/work/template-contract';
import { BlueprintMilestoneFields } from '@docket/work/work-template-blueprint';

/** Private preset projection; its data carries no authority to insert or adopt any work. */
export interface RetainedBlueprintPreset {
  readonly sourceStepId: string;
  readonly kind: BlueprintInvocationOverride['kind'];
  readonly fields: ResolvedBlueprintFields;
  readonly placement: BlueprintPlacement;
  readonly override: BlueprintNodeOverride;
  readonly labelIds: readonly string[];
}
const ordinaryKeys = [
  'title',
  'name',
  'summary',
  'description',
  'priority',
  'state',
  'status',
  'health',
  'estimate',
  'estimateMinutes',
  'labelIds',
] as const;
function fieldsOf(entry: BlueprintInvocationOverride, runDate: string): ResolvedBlueprintFields {
  const values: Record<string, unknown> = Object.fromEntries(
    ordinaryKeys
      .filter(
        (key) =>
          (key !== 'labelIds' || entry.kind === 'task') &&
          entry.fields[key] !== undefined &&
          entry.fields[key] !== null,
      )
      .map((key) => [key, entry.fields[key]]),
  );
  if (entry.fields['estimate_minutes'] !== undefined)
    values['estimateMinutes'] = entry.fields['estimate_minutes'];
  for (const key of ['title', 'name'])
    if (typeof values[key] === 'string') values[key] = renderName(values[key], runDate);
  const parsed =
    entry.kind === 'milestone'
      ? BlueprintMilestoneFields.parse(values)
      : CanonicalTemplateDraft.parse({ targetType: entry.kind, ...values });
  const fields = 'targetType' in parsed ? withoutKind(parsed) : parsed;
  return {
    ...fields,
    ...(entry.fields['summary'] === null ? { summary: null } : {}),
    ...(entry.kind === 'project' && entry.fields['health'] === null ? { health: null } : {}),
    ...(entry.fields['description'] === null ? { description: '' } : {}),
  };
}
function withoutKind(value: CanonicalTemplateDraft): ResolvedBlueprintFields {
  const { targetType: _kind, ...fields } = value;
  return fields;
}
function renderName(value: string, runDate: string): string {
  const [year = '', month = ''] = runDate.split('-');
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${year}-${month}-01T00:00:00.000Z`),
  );
  return value
    .replaceAll('{date}', runDate)
    .replaceAll('{year}', year)
    .replaceAll('{month}', month)
    .replaceAll('{monthName}', monthName);
}
function ref(
  fields: BlueprintInvocationOverride['fields'],
  key: string,
): string | null | undefined {
  const value = fields[key];
  return typeof value === 'string' || value === null ? value : undefined;
}
function planningDate(
  entry: BlueprintInvocationOverride,
  runDate: string,
  completions: ReadonlyMap<string, string>,
): string | null {
  if (entry.timing.kind === 'on_trigger') return runDate;
  const anchor =
    entry.timing.kind === 'relative_to_trigger'
      ? runDate
      : completions.get(entry.timing.afterStepId ?? '');
  return anchor ? addCalendarDays(anchor, entry.timing.offsetDays ?? 0) : null;
}
function datesOf(
  entry: BlueprintInvocationOverride,
  runDate: string,
  completions: ReadonlyMap<string, string>,
) {
  const date = (key: string, fallback: string | null): string | null =>
    typeof entry.fields[key] === 'number' ? addCalendarDays(runDate, entry.fields[key]) : fallback;
  const anchor = planningDate(entry, runDate, completions);
  if (entry.kind === 'project')
    return {
      startDate: date('start_offset_days', anchor),
      targetDate: date('target_offset_days', null),
    };
  if (entry.kind === 'milestone') return { targetDate: date('target_offset_days', anchor) };
  return { startDate: date('start_offset_days', null), dueDate: date('due_offset_days', anchor) };
}
function placementOf(fields: BlueprintInvocationOverride['fields']): BlueprintPlacement {
  const placement: {
    programId?: string | null;
    projectId?: string | null;
    milestoneId?: string | null;
    parentTaskId?: string | null;
  } = {};
  const pairs = [
    ['programId', 'program_id'],
    ['projectId', 'project_id'],
    ['milestoneId', 'milestone_id'],
    ['parentTaskId', 'parent_task_id'],
  ] as const;
  for (const [key, stored] of pairs) {
    const value = ref(fields, stored);
    if (value !== undefined) placement[key] = value;
  }
  return placement;
}
/** Compile one persisted private preset into ordinary fields and exact schedule dates, without execution privileges. */
export function compileRetainedPreset(
  source: BlueprintInvocationStep,
  entry: BlueprintInvocationOverride,
  runDate: string,
  completions: ReadonlyMap<string, string>,
): RetainedBlueprintPreset {
  const fields = fieldsOf(entry, runDate);
  const team = ref(entry.fields, 'team_id');
  const actor = ref(entry.fields, entry.kind === 'project' ? 'lead_id' : 'assignee_id');
  const cycle = ref(entry.fields, 'cycle_id');
  return {
    sourceStepId: source.sourceStepId,
    kind: entry.kind,
    fields,
    labelIds: Array.isArray(entry.fields['labelIds']) ? entry.fields['labelIds'] : [],
    placement: placementOf(entry.fields),
    override: {
      path: source.path,
      fields,
      documentPrepared: true,
      dates: datesOf(entry, runDate, completions),
      ...(team !== undefined ? { teamId: team === null ? null : TeamId.parse(team) } : {}),
      ...(actor !== undefined
        ? { responsibleActorId: actor === null ? null : ActorId.parse(actor) }
        : {}),
      ...(cycle !== undefined ? { cycleId: cycle === null ? null : CycleId.parse(cycle) } : {}),
    },
  };
}
