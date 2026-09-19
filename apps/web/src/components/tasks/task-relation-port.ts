import type {
  RelationCommandPort,
  RelationEndpoint,
  RelationIntent,
} from '@docket/work/relation-contract';

/** Task relations implemented by the existing typed Task update route. */
export type PatchableTaskRelationId =
  'task.project' | 'task.program' | 'task.cycle' | 'task.milestone' | 'task.assignee';

/** Task relation implemented by the existing workflow-aware work-view transition use case. */
export type TaskTeamRelationId = 'task.team';

/** Narrow Task relation intent accepted by this application port. */
export interface PatchableTaskRelationIntent extends Omit<
  RelationIntent,
  'relationId' | 'subjects'
> {
  readonly relationId: PatchableTaskRelationId;
  readonly subjects: readonly (RelationEndpoint & { readonly kind: 'task' })[];
}

/** The Task update fields owned by these relations. */
export interface TaskRelationPatch {
  readonly projectId?: string;
  readonly programId?: string;
  readonly cycleId?: string;
  readonly milestoneId?: string;
  readonly assigneeId?: string;
}

/** Dependencies supplied by the typed Task API adapter. */
export interface TaskRelationCommandDependencies {
  /** Patch one Task through the Task-owned application API. */
  readonly patchTask: (
    organizationId: string,
    taskId: string,
    patch: TaskRelationPatch,
  ) => Promise<void>;
  /** Move one Task through the workflow-aware Team transition use case. */
  readonly moveTaskToTeam?: (
    organizationId: string,
    taskId: string,
    teamId: string,
  ) => Promise<void>;
}

const PATCH_FIELD: Record<PatchableTaskRelationId, keyof TaskRelationPatch> = {
  'task.project': 'projectId',
  'task.program': 'programId',
  'task.cycle': 'cycleId',
  'task.milestone': 'milestoneId',
  'task.assignee': 'assigneeId',
};

/**
 * Build the Task-owned port for single-valued relation commands.
 *
 * @param dependencies - Typed Task persistence adapter.
 * @returns A narrowed Task relation command port.
 */
export function createTaskRelationCommandPort(
  dependencies: TaskRelationCommandDependencies,
): RelationCommandPort<PatchableTaskRelationIntent> {
  return {
    execute: async (intent) => {
      const organizationId = intent.target.organizationId;
      if (organizationId === null) return { status: 'unchanged' };
      const field = PATCH_FIELD[intent.relationId];
      let applied = false;
      for (const subject of intent.subjects) {
        if (subject.meta?.[field] === intent.target.id) continue;
        await dependencies.patchTask(organizationId, subject.id, {
          [field]: intent.target.id,
        });
        applied = true;
      }
      return { status: applied ? 'applied' : 'unchanged' };
    },
  };
}

/** Narrow Task-to-Team intent accepted by the workflow-aware port. */
export interface TaskTeamRelationIntent extends Omit<RelationIntent, 'relationId' | 'subjects'> {
  readonly relationId: TaskTeamRelationId;
  readonly subjects: readonly (RelationEndpoint & { readonly kind: 'task' })[];
}

/** Build the Task-owned port for workflow-aware Team transitions. */
export function createTaskTeamRelationCommandPort(
  dependencies: Required<Pick<TaskRelationCommandDependencies, 'moveTaskToTeam'>>,
): RelationCommandPort<TaskTeamRelationIntent> {
  return {
    execute: async (intent) => {
      const organizationId = intent.target.organizationId;
      if (organizationId === null) return { status: 'unchanged' };
      let applied = false;
      for (const subject of intent.subjects) {
        if (subject.meta?.['teamId'] === intent.target.id) continue;
        await dependencies.moveTaskToTeam(organizationId, subject.id, intent.target.id);
        applied = true;
      }
      return { status: applied ? 'applied' : 'unchanged' };
    },
  };
}

/** Task relations that use hierarchy, dependency, label, or Calendar application services. */
export type TaskAssociationRelationId =
  'task.parent' | 'task.blocks' | 'task.label' | 'task.calendar-item' | 'task.calendar-slot';

/** Narrow Task association intent accepted by the application-service port. */
export interface TaskAssociationRelationIntent extends Omit<
  RelationIntent,
  'relationId' | 'subjects'
> {
  readonly relationId: TaskAssociationRelationId;
  readonly subjects: readonly (RelationEndpoint & { readonly kind: 'task' })[];
}

/** Task-owned operations injected into the association command port. */
export interface TaskAssociationCommandDependencies {
  readonly reparent: (
    organizationId: string,
    moves: readonly { readonly taskId: string; readonly parentTaskId: string | null }[],
  ) => void | Promise<void>;
  readonly addDependency: (
    organizationId: string,
    blockingTaskId: string,
    blockedTaskId: string,
  ) => Promise<'applied' | 'unchanged'>;
  readonly addLabel: (
    organizationId: string,
    taskId: string,
    labelId: string,
  ) => Promise<'applied' | 'unchanged'>;
  readonly linkCalendarItem: (
    organizationId: string,
    taskId: string,
    calendarItemId: string,
  ) => Promise<'applied' | 'unchanged'>;
  readonly scheduleCalendarSlot: (
    organizationId: string,
    taskId: string,
    title: string,
    startsAt: string,
    endsAt: string,
  ) => Promise<'applied' | 'unchanged'>;
}

async function handleParentRelation(
  organizationId: string,
  intent: TaskAssociationRelationIntent,
  dependencies: TaskAssociationCommandDependencies,
): Promise<boolean> {
  await dependencies.reparent(
    organizationId,
    intent.subjects.map(({ id }) => ({ taskId: id, parentTaskId: intent.target.id })),
  );
  return true;
}

async function handleBlocksRelation(
  organizationId: string,
  subject: RelationEndpoint,
  targetId: string,
  dependencies: TaskAssociationCommandDependencies,
): Promise<'applied' | 'unchanged'> {
  return dependencies.addDependency(organizationId, subject.id, targetId);
}

async function handleLabelRelation(
  organizationId: string,
  subject: RelationEndpoint,
  targetId: string,
  dependencies: TaskAssociationCommandDependencies,
): Promise<'applied' | 'unchanged'> {
  return dependencies.addLabel(organizationId, subject.id, targetId);
}

async function handleCalendarItemRelation(
  organizationId: string,
  subject: RelationEndpoint,
  targetId: string,
  dependencies: TaskAssociationCommandDependencies,
): Promise<'applied' | 'unchanged'> {
  return dependencies.linkCalendarItem(organizationId, subject.id, targetId);
}

async function handleCalendarSlotRelation(
  organizationId: string,
  subject: RelationEndpoint,
  target: RelationEndpoint,
  dependencies: TaskAssociationCommandDependencies,
): Promise<'applied' | 'unchanged' | null> {
  const startsAt = target.meta?.['startsAt'];
  const endsAt = target.meta?.['endsAt'];
  if (typeof startsAt !== 'string' || typeof endsAt !== 'string') return null;
  const title = subject.meta?.['title'];
  return dependencies.scheduleCalendarSlot(
    organizationId,
    subject.id,
    typeof title === 'string' ? title : 'Task',
    startsAt,
    endsAt,
  );
}

/** Build the Task-owned port for associations that are not property patches. */
export function createTaskAssociationCommandPort(
  dependencies: TaskAssociationCommandDependencies,
): RelationCommandPort<TaskAssociationRelationIntent> {
  return {
    execute: async (intent) => {
      const organizationId = intent.subjects[0]?.organizationId ?? intent.target.organizationId;
      if (organizationId === null || intent.subjects.length === 0) {
        return { status: 'unchanged' };
      }
      if (intent.relationId === 'task.parent') {
        const applied = await handleParentRelation(organizationId, intent, dependencies);
        return { status: applied ? 'applied' : 'unchanged' };
      }
      let applied = false;
      for (const subject of intent.subjects) {
        let status: 'applied' | 'unchanged' | null;
        if (intent.relationId === 'task.blocks') {
          status = await handleBlocksRelation(
            organizationId,
            subject,
            intent.target.id,
            dependencies,
          );
        } else if (intent.relationId === 'task.label') {
          status = await handleLabelRelation(
            organizationId,
            subject,
            intent.target.id,
            dependencies,
          );
        } else if (intent.relationId === 'task.calendar-item') {
          status = await handleCalendarItemRelation(
            organizationId,
            subject,
            intent.target.id,
            dependencies,
          );
        } else {
          status = await handleCalendarSlotRelation(
            organizationId,
            subject,
            intent.target,
            dependencies,
          );
        }
        if (status === 'applied') applied = true;
      }
      return { status: applied ? 'applied' : 'unchanged' };
    },
  };
}
