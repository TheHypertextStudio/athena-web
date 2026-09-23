import { ActorId } from '@docket/identity-access/ids';
import { LabelId, MilestoneId, ProgramId, ProjectId } from '@docket/work/ids';
import type { TaskUpdate } from '@docket/work/task-model';

import { cycleAssignmentRequest } from './task-cycle-mutation';
import type { TaskPatch } from './use-task-mutations';

/** One named body field, present only when the patch sets it. */
type BodyField<TKey extends string, TValue> = Partial<Record<TKey, TValue>>;

/** `{ [key]: value }` when the patch names the field, else nothing. */
function field<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): BodyField<TKey, TValue> {
  return value === undefined ? {} : ({ [key]: value } as BodyField<TKey, TValue>);
}

/** A reference id branded for the request, `null` to clear it, or `undefined` when unnamed. */
function reference<TId>(
  value: string | null | undefined,
  parse: (id: string) => TId,
): TId | null | undefined {
  if (value === undefined || value === null) return value;
  return parse(value);
}

/**
 * Build the `PATCH /tasks/:id` body for a task-detail patch.
 *
 * @remarks
 * An explicit field whitelist: a field on {@link TaskPatch} that is missing here compiles, saves
 * nothing, and still looks saved. Only fields the patch names are sent; `null` clears.
 *
 * @param patch - The fields to change.
 * @returns the request body.
 */
export function taskPatchBody(patch: TaskPatch): TaskUpdate {
  return {
    ...field('title', patch.title),
    ...field('description', patch.description),
    ...field(
      'assigneeId',
      reference(patch.assigneeId, (id) => ActorId.parse(id)),
    ),
    ...field(
      'projectId',
      reference(patch.projectId, (id) => ProjectId.parse(id)),
    ),
    ...field(
      'programId',
      reference(patch.programId, (id) => ProgramId.parse(id)),
    ),
    ...field(
      'milestoneId',
      reference(patch.milestoneId, (id) => MilestoneId.parse(id)),
    ),
    ...cycleAssignmentRequest(patch),
    ...field('estimate', patch.estimate),
    ...field('estimateMinutes', patch.estimateMinutes),
    ...field('startDate', patch.startDate),
    ...field('dueDate', patch.dueDate),
    ...field(
      'labels',
      patch.labels?.map((id) => LabelId.parse(id)),
    ),
  };
}
