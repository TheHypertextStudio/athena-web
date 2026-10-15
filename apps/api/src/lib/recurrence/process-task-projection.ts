/** Reconstruct authored task and timing contracts from normalized process rows. */
import type { processStep, processTaskSpec } from '@docket/db';
import { ProcessTaskSpec, type ProcessStepTiming } from '../../contracts/recurrence';
import { ConflictError } from '../../error';
import { processTaskTemplateIdentity } from './task-template-identity';

/** Convert normalized timing columns back to the public discriminated timing union. */
export function timingFromRow(
  row: typeof processStep.$inferSelect,
  keysByStepId: ReadonlyMap<string, string>,
): ProcessStepTiming {
  if (row.timingKind === 'on_trigger') return { kind: 'on_trigger' };
  if (row.timingKind === 'relative_to_trigger') {
    return { kind: 'relative_to_trigger', offsetDays: row.offsetDays ?? 0 };
  }
  const stepKey = row.afterStepId ? keysByStepId.get(row.afterStepId) : undefined;
  if (!stepKey) throw new ConflictError('Published process timing is incomplete');
  return {
    kind: 'after_step_completion',
    stepKey,
    offsetDays: row.offsetDays ?? 0,
  };
}

/** Restore a published process revision's task specifications without losing identity. */
export function projectProcessTasks(
  taskSpecs: (typeof processTaskSpec.$inferSelect)[],
  stepsById: ReadonlyMap<string, typeof processStep.$inferSelect>,
  keysByStepId: ReadonlyMap<string, string>,
  taskLabelsByStep: ReadonlyMap<string, string[]>,
): ProcessTaskSpec[] {
  return taskSpecs.map((spec) => {
    const step = stepsById.get(spec.stepId);
    if (!step) throw new ConflictError('Published task specification is incomplete');
    return ProcessTaskSpec.parse({
      key: step.key,
      title: spec.title,
      description: optional(spec.description),
      teamId: spec.teamId,
      ...processTaskTemplateIdentity(spec),
      state: optional(spec.state),
      priority: spec.priority,
      assigneeId: optional(spec.assigneeId),
      projectId: optional(spec.projectId),
      projectKey: stepKey(spec.projectStepId, keysByStepId),
      milestoneId: optional(spec.milestoneId),
      milestoneKey: stepKey(spec.milestoneStepId, keysByStepId),
      cycleId: optional(spec.cycleId),
      parentTaskId: optional(spec.parentTaskId),
      parentTaskKey: stepKey(spec.parentTaskStepId, keysByStepId),
      estimate: optional(spec.estimate),
      estimateMinutes: optional(spec.estimateMinutes),
      startOffsetDays: optional(spec.startOffsetDays),
      dueOffsetDays: optional(spec.dueOffsetDays),
      labelIds: taskLabelsByStep.get(spec.stepId) ?? [],
      timing: timingFromRow(step, keysByStepId),
    });
  });
}

/** Omit nullable storage fields in authoring contracts. */
function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

/** Recover the stable authored key for a generated work reference. */
function stepKey(id: string | null, keys: ReadonlyMap<string, string>): string | undefined {
  return id === null ? undefined : keys.get(id);
}
