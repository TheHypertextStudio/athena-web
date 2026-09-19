/**
 * `@docket/api` — what a change set may record, and the tables it records against.
 *
 * @remarks
 * A leaf module: the recording side in `./change-set` and the reversal side in
 * `./change-set-undo` both read it, and neither reads the other. Keeping these declarations out
 * of both is what lets the two sides stay independent.
 */
import {
  initiative,
  initiativeProgram,
  initiativeProject,
  program,
  project,
  projectDependency,
  projectLabel,
  task,
  taskDependency,
  taskLabel,
  taskRelatedTask,
} from '@docket/db';
import type { db } from '@docket/db';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

/** The entity kinds a change set can record, mapped to the table they live in. */
export const RECORDABLE = { task, project, program, initiative } as const;

/** One recordable entity kind. */
export type RecordableKind = keyof typeof RECORDABLE;

/** The columns every recordable row exposes to change-set reads and reversals. */
export type RecordableTable = PgTable & {
  id: AnyPgColumn;
  organizationId: AnyPgColumn;
  archivedAt: AnyPgColumn;
};

/**
 * The relations a change set can record, mapped to the join table and endpoint columns.
 *
 * @remarks
 * Kept apart from {@link RECORDABLE} because a relation has no row state to restore — reversing
 * one means deleting or re-inserting an edge, not writing columns back. Subtask parentage is
 * deliberately absent: it lives in a column on `task`, so it reverses through the ordinary update
 * path rather than needing an entry of its own.
 */
export const RELATIONS = {
  blocks: {
    table: taskDependency,
    from: taskDependency.blockingTaskId,
    to: taskDependency.blockedTaskId,
  },
  project_blocks: {
    table: projectDependency,
    from: projectDependency.blockingProjectId,
    to: projectDependency.blockedProjectId,
  },
  task_has_label: {
    table: taskLabel,
    from: taskLabel.taskId,
    to: taskLabel.labelId,
  },
  project_has_label: {
    table: projectLabel,
    from: projectLabel.projectId,
    to: projectLabel.labelId,
  },
  related_task: {
    table: taskRelatedTask,
    from: taskRelatedTask.taskId,
    to: taskRelatedTask.relatedTaskId,
  },
  project_contributes_to: {
    table: initiativeProject,
    from: initiativeProject.projectId,
    to: initiativeProject.initiativeId,
  },
  program_contributes_to: {
    table: initiativeProgram,
    from: initiativeProgram.programId,
    to: initiativeProgram.initiativeId,
  },
} as const;

/** One recordable relation. */
export type RelationKind = keyof typeof RELATIONS;

/** Whether a recorded `entityKind` names a relation rather than an entity. */
export function isRelation(kind: string): kind is RelationKind {
  return kind in RELATIONS;
}

/** The composite key a relation entry is stored under, since an edge has no id of its own. */
export function edgeKey(from: string, to: string): string {
  return `${from}:${to}`;
}

/**
 * The columns a change set records per kind, and the only ones undo restores.
 *
 * @remarks
 * Recording the whole row would make undo refuse on any unrelated edit — `updatedAt` alone would
 * defeat it. Narrowing to the fields a tool can actually write is what lets undo work on a live
 * workspace rather than only an untouched one. `archivedAt` is here because archive is a recorded
 * op; the external-provenance columns are not, because no tool on this surface writes them.
 */
export const TRACKED: Record<RecordableKind, readonly string[]> = {
  task: [
    'title',
    'description',
    'state',
    'statusId',
    'priority',
    'assigneeId',
    'delegateId',
    'projectId',
    'programId',
    'milestoneId',
    'cycleId',
    'parentTaskId',
    'teamId',
    'templateId',
    'estimate',
    'estimateMinutes',
    'startDate',
    'dueDate',
    'estimate',
    'completedAt',
    'canceledAt',
    'autoCompletedBySubtasks',
    'archivedAt',
  ],
  project: [
    'name',
    'description',
    'status',
    'statusId',
    'priority',
    'health',
    'leadId',
    'programId',
    'teamId',
    'startDate',
    'startDateResolution',
    'startDateFiscalYearStartMonth',
    'targetDate',
    'targetDateResolution',
    'targetDateFiscalYearStartMonth',
    'archivedAt',
  ],
  program: ['name', 'description', 'status', 'health', 'ownerId', 'archivedAt'],
  initiative: [
    'name',
    'description',
    'status',
    'health',
    'priority',
    'ownerId',
    'targetDate',
    'targetDateResolution',
    'targetDateFiscalYearStartMonth',
    'archivedAt',
  ],
};

/** What an undo did, per entity. */
export interface UndoOutcome {
  readonly kind: string;
  readonly id: string;
  readonly reverted: boolean;
  /** Why it was left alone, when it was. */
  readonly reason?: string;
}

/** The database transaction handle used by reversible operations. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
