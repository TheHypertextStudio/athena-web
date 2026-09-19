/** Value normalization and serialization for object commands. */

import type { ObjectCommandValue } from '../../contracts/object-command';

/** Normalize a value to a JSON-serializable command format. */
export function normalize(value: unknown): ObjectCommandValue {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  throw new Error('Command receipt value was not scalar');
}

/**
 * Normalize a property value: date properties serialize to ISO date strings (YYYY-MM-DD),
 * timestamps serialize to ISO full timestamps.
 */
export function normalizeProperty(property: string, value: unknown): ObjectCommandValue {
  if (value instanceof Date && ['startDate', 'dueDate'].includes(property)) {
    return value.toISOString().slice(0, 10);
  }
  return normalize(value);
}

/**
 * Reverse normalization: convert command format values back to database format.
 * Date properties are parsed from ISO date strings, timestamps from ISO full strings.
 */
export function dbValue(property: string, value: ObjectCommandValue): unknown {
  if (
    value !== null &&
    ['startDate', 'dueDate', 'targetDate', 'archivedAt', 'completedAt', 'canceledAt'].includes(
      property,
    )
  ) {
    return new Date(String(value));
  }
  return value;
}

/** Properties allowed on task objects in command receipts. */
export const TASK_PROPERTIES = new Set([
  'title',
  'state',
  'statusId',
  'completedAt',
  'canceledAt',
  'priority',
  'assigneeId',
  'projectId',
  'programId',
  'milestoneId',
  'cycleId',
  'startDate',
  'dueDate',
  'estimate',
  'parentTaskId',
  'archivedAt',
]);

/** Properties allowed on project objects in command receipts. */
export const PROJECT_PROPERTIES = new Set([
  'status',
  'statusId',
  'priority',
  'health',
  'leadId',
  'teamId',
  'programId',
  'startDate',
  'startDateResolution',
  'startDateFiscalYearStartMonth',
  'targetDate',
  'targetDateResolution',
  'targetDateFiscalYearStartMonth',
  'archivedAt',
]);
