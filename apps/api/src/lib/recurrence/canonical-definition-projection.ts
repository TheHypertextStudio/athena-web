import type {
  invocationRevision,
  InvocationRevisionProjection,
  ScheduleSourceArchive,
} from '@docket/db';
import {
  ProcessProjectSpec,
  ProcessMilestoneSpec,
  ProcessTaskSpec,
  ProcessRevisionOut,
  ProcessStepTiming,
} from '../../contracts/recurrence';
import { ConflictError } from '../../error';

type Row = Readonly<Record<string, unknown>>;
function rows(source: Row, key: string): Row[] {
  const value = source[key];
  if (!Array.isArray(value) || value.some((row) => row === null || typeof row !== 'object'))
    throw new ConflictError('Private revision body is incomplete.');
  return value as Row[];
}
function values(row: Row, mapping: Readonly<Record<string, string>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(mapping).flatMap(([key, column]) =>
      row[column] === null || row[column] === undefined ? [] : [[key, row[column]]],
    ),
  );
}
function byId(source: Row, key: string, id: string): Row {
  const row = rows(source, key).find((row) => row['step_id'] === id);
  if (!row) throw new ConflictError('Private revision body is incomplete.');
  return row;
}
function timing(step: Row, keys: ReadonlyMap<string, string>) {
  const kind = step['timing_kind'];
  if (kind === 'on_trigger') return ProcessStepTiming.parse({ kind });
  if (kind === 'relative_to_trigger')
    return ProcessStepTiming.parse({ kind, offsetDays: step['offset_days'] ?? 0 });
  const stepKey = keys.get(String(step['after_step_id']));
  if (!stepKey) throw new ConflictError('Private revision timing is incomplete.');
  return ProcessStepTiming.parse({ kind, stepKey, offsetDays: step['offset_days'] ?? 0 });
}
function labels(source: Row, id: string, kind: 'task' | 'project'): string[] {
  return rows(source, kind === 'task' ? 'taskLabels' : 'projectLabels')
    .filter((row) => row[kind === 'task' ? 'task_step_id' : 'project_step_id'] === id)
    .map((row) => String(row['label_id']));
}
function projectBody(source: Row, step: Row, keys: ReadonlyMap<string, string>) {
  const spec = byId(source, 'projects', String(step['id']));
  return ProcessProjectSpec.parse({
    key: step['key'],
    ...values(spec, {
      name: 'name',
      summary: 'summary',
      description: 'description',
      leadId: 'lead_id',
      teamId: 'team_id',
      programId: 'program_id',
      status: 'status',
      health: 'health',
      startOffsetDays: 'start_offset_days',
      targetOffsetDays: 'target_offset_days',
    }),
    labelIds: labels(source, String(step['id']), 'project'),
    timing: timing(step, keys),
  });
}
function milestoneBody(source: Row, step: Row, keys: ReadonlyMap<string, string>) {
  const spec = byId(source, 'milestones', String(step['id']));
  return ProcessMilestoneSpec.parse({
    key: step['key'],
    projectKey: keys.get(String(spec['project_step_id'])),
    sort: step['sort'],
    ...values(spec, {
      name: 'name',
      description: 'description',
      targetOffsetDays: 'target_offset_days',
    }),
    timing: timing(step, keys),
  });
}
function taskBody(source: Row, step: Row, keys: ReadonlyMap<string, string>) {
  const spec = byId(source, 'tasks', String(step['id']));
  return ProcessTaskSpec.parse({
    key: step['key'],
    ...values(spec, {
      title: 'title',
      description: 'description',
      teamId: 'team_id',
      workTypeId: 'work_type_id',
      workTypeVersionId: 'work_type_version_id',
      state: 'state',
      priority: 'priority',
      assigneeId: 'assignee_id',
      projectId: 'project_id',
      milestoneId: 'milestone_id',
      cycleId: 'cycle_id',
      parentTaskId: 'parent_task_id',
      estimate: 'estimate',
      estimateMinutes: 'estimate_minutes',
      startOffsetDays: 'start_offset_days',
      dueOffsetDays: 'due_offset_days',
    }),
    projectKey: keys.get(String(spec['project_step_id'])),
    milestoneKey: keys.get(String(spec['milestone_step_id'])),
    parentTaskKey: keys.get(String(spec['parent_task_step_id'])),
    labelIds: labels(source, String(step['id']), 'task'),
    timing: timing(step, keys),
  });
}
/** Project the exact private old DTO from proved frozen source, never from current normalized SQL rows. */
export function projectCanonicalDefinitionRevision(
  revision: typeof invocationRevision.$inferSelect,
  archive: ScheduleSourceArchive,
): ProcessRevisionOut {
  const source = archive.source;
  const projection: InvocationRevisionProjection = revision.projection;
  const raw = rows(source, 'steps');
  const steps = projection.steps.map((entry) => {
    const step = raw.find(
      (step) =>
        step['id'] === entry.alias &&
        step['key'] === entry.key &&
        step['kind'] === entry.kind &&
        step['sort'] === entry.sort,
    );
    if (!step) throw new ConflictError('Private revision ordering is incomplete.');
    return step;
  });
  if (steps.length !== raw.length)
    throw new ConflictError('Private revision ordering is incomplete.');
  const keys = new Map(steps.map((step) => [String(step['id']), String(step['key'])]));
  const project = steps.find((step) => step['kind'] === 'project');
  return ProcessRevisionOut.parse({
    id: revision.id,
    definitionId: revision.headId,
    number: revision.number,
    creationMode: revision.creationMode,
    ...(project ? { project: projectBody(source, project, keys) } : {}),
    milestones: steps
      .filter((step) => step['kind'] === 'milestone')
      .map((step) => milestoneBody(source, step, keys)),
    tasks: steps
      .filter((step) => step['kind'] === 'task')
      .map((step) => taskBody(source, step, keys)),
    dependencies: rows(source, 'dependencies').map((edge) => ({
      blockingStepKey: keys.get(String(edge['blocking_step_id'])),
      blockedStepKey: keys.get(String(edge['blocked_step_id'])),
    })),
    createdAt: revision.createdAt.toISOString(),
    publishedAt: revision.publishedAt?.toISOString() ?? null,
  });
}
