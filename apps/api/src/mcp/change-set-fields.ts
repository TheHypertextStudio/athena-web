/** Fields owned by MCP writes and compared before undoing their changes. */
import type { RecordableKind } from './change-set';

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
    'summary',
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
    'completedAt',
    'canceledAt',
    'autoCompletedBySubtasks',
    'archivedAt',
    'blueprintDateBindings',
    'workTypeId',
    'workTypeVersionId',
    'workTypeAssignedAt',
    'workTypeAssignmentSource',
    'blueprintState',
  ],
  project: [
    'visibility',
    'name',
    'description',
    'summary',
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
    'blueprintDateBindings',
    'workTypeId',
    'workTypeVersionId',
    'workTypeAssignedAt',
    'workTypeAssignmentSource',
    'blueprintState',
  ],
  program: [
    'name',
    'description',
    'summary',
    'status',
    'statusId',
    'health',
    'visibility',
    'ownerId',
    'archivedAt',
    'blueprintDateBindings',
    'workTypeId',
    'workTypeVersionId',
    'workTypeAssignedAt',
    'workTypeAssignmentSource',
    'blueprintState',
  ],
  initiative: [
    'statusId',
    'updateCadence',
    'name',
    'description',
    'summary',
    'status',
    'health',
    'priority',
    'ownerId',
    'targetDate',
    'targetDateResolution',
    'targetDateFiscalYearStartMonth',
    'archivedAt',
    'blueprintDateBindings',
    'workTypeId',
    'workTypeVersionId',
    'workTypeAssignedAt',
    'workTypeAssignmentSource',
    'blueprintState',
  ],
  milestone: ['projectId', 'name', 'description', 'targetDate', 'sort', 'blueprintDateBindings'],
};

/**
 * Project a row down to the fields a change set tracks for its kind.
 *
 * @param kind - The entity kind.
 * @param row - The full row.
 * @returns the tracked subset.
 */
export function trackedFields(
  kind: RecordableKind,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    TRACKED[kind].map((key) => [key, comparableTrackedValue(key, row[key])]),
  );
}

/** Exclude receipt identity from state comparisons while retaining accepted dependency ownership and manifests. */
export function comparableTrackedValue(key: string, value: unknown): unknown {
  if (key === 'blueprintState' && value && typeof value === 'object' && !Array.isArray(value))
    return { ...value, lastApplicationChangeSetId: null };
  return value instanceof Date ? value.toISOString() : value;
}
