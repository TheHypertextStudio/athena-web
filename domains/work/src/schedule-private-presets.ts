import { WorkScheduleRootDraft, WorkScheduleStepOverride } from './contracts/work-schedule-fields';
/** Literal private authored/retained starting data; structure and source evidence are checked separately. */
export interface PrivateSchedulePreset {
  readonly kind: 'task' | 'project' | 'milestone';
  readonly fields: Readonly<Record<string, unknown>>;
}
function reference(
  fields: Readonly<Record<string, unknown>>,
  name: string,
): string | null | undefined {
  const value = fields[name];
  return typeof value === 'string' || value === null ? value : undefined;
}
function fields(entry: PrivateSchedulePreset): Record<string, unknown> {
  const keys =
    entry.kind === 'milestone'
      ? ['name', 'description']
      : entry.kind === 'task'
        ? ['title', 'description', 'summary', 'state', 'priority', 'estimate']
        : ['name', 'description', 'summary', 'status', 'health'];
  const result: Record<string, unknown> = Object.fromEntries(
    keys
      .filter(
        (key) =>
          entry.fields[key] !== undefined &&
          (entry.fields[key] !== null || ['description', 'summary', 'health'].includes(key)),
      )
      .map((key) => [key, entry.fields[key]]),
  );
  if (result['description'] === null) result['description'] = '';
  if (entry.kind === 'task' && entry.fields['estimate_minutes'] !== undefined)
    result['estimateMinutes'] = entry.fields['estimate_minutes'];
  if (entry.kind !== 'milestone' && entry.fields['labelIds'] !== undefined)
    result['labelIds'] = entry.fields['labelIds'];
  return result;
}
function assignments(entry: PrivateSchedulePreset): Record<string, unknown> {
  if (entry.kind === 'milestone') return {};
  const teamId = reference(entry.fields, 'team_id');
  const responsibleActorId = reference(
    entry.fields,
    entry.kind === 'project' ? 'lead_id' : 'assignee_id',
  );
  const cycleId = reference(entry.fields, 'cycle_id');
  return {
    ...(teamId !== undefined ? { teamId } : {}),
    ...(responsibleActorId !== undefined ? { responsibleActorId } : {}),
    ...(entry.kind === 'task' && cycleId !== undefined ? { cycleId } : {}),
  };
}
/** Project literal private starting fields and real destinations without source or execution authority. */
export function privateScheduleRootFromPreset(entry: PrivateSchedulePreset): WorkScheduleRootDraft {
  const pairs =
    entry.kind === 'project'
      ? [['programId', 'program_id']]
      : [
          ['projectId', 'project_id'],
          ['milestoneId', 'milestone_id'],
          ['parentTaskId', 'parent_task_id'],
        ];
  const placement: Record<string, unknown> = {};
  for (const [key, column] of pairs) {
    const value = reference(entry.fields, column ?? '');
    if (key && value !== undefined) placement[key] = value;
  }
  return WorkScheduleRootDraft.parse({
    kind: entry.kind,
    fields: fields(entry),
    dates: {},
    placement,
    ...assignments(entry),
  });
}
/** Project kind-correlated private overrides for an already checked exact selected publication path. */
export function privateScheduleStepFromPreset(
  entry: PrivateSchedulePreset,
  path: readonly string[],
): WorkScheduleStepOverride {
  return WorkScheduleStepOverride.parse({
    kind: entry.kind,
    path: [...path],
    fields: fields(entry),
    dates: {},
    ...assignments(entry),
  });
}
