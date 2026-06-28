/**
 * Bulk route helpers.
 *
 * @packageDocumentation
 */

export const TASK_PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

export const TASK_STATUS_VALUES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

export const DEFAULT_TASK_PRIORITY: TaskPriority = 'medium';
export const DEFAULT_TASK_STATUS: TaskStatus = 'pending';
export const IMPORTED_PROJECT_STATUS = 'active' as const;
export const ERROR_NO_TASKS_FOUND = 'No tasks found';
export const ERROR_PROJECT_NOT_FOUND = 'Project not found';

export const isTaskPriority = (value: string): value is TaskPriority =>
  TASK_PRIORITY_VALUES.includes(value as TaskPriority);
