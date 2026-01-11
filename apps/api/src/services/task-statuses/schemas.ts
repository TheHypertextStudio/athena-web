/**
 * Task status schemas for validation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

export const TaskStatusCategory = z.enum(['not_started', 'in_progress', 'done', 'cancelled']);
export type TaskStatusCategory = z.infer<typeof TaskStatusCategory>;

export const ListTaskStatusesInput = z.object({
  workspaceId: z.uuid().optional(),
  category: TaskStatusCategory.optional(),
});
export type ListTaskStatusesInput = z.infer<typeof ListTaskStatusesInput>;

export const CreateTaskStatusInput = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  category: TaskStatusCategory,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  icon: z.string().max(50).optional(),
  workspaceId: z.uuid().optional(),
});
export type CreateTaskStatusInput = z.infer<typeof CreateTaskStatusInput>;

export const UpdateTaskStatusInput = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(500).nullish(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  icon: z.string().max(50).nullish(),
});
export type UpdateTaskStatusInput = z.infer<typeof UpdateTaskStatusInput>;

export const ReorderTaskStatusesInput = z.object({
  category: TaskStatusCategory,
  statusIds: z.array(z.uuid()).min(1),
  workspaceId: z.uuid().optional(),
});
export type ReorderTaskStatusesInput = z.infer<typeof ReorderTaskStatusesInput>;

export const TaskStatusIdParam = z.object({
  id: z.uuid(),
});
export type TaskStatusIdParam = z.infer<typeof TaskStatusIdParam>;

/**
 * Default statuses created for each new workspace.
 */
export const DEFAULT_TASK_STATUSES: Omit<CreateTaskStatusInput, 'workspaceId'>[] = [
  // Not Started category
  {
    name: 'Backlog',
    category: 'not_started',
    color: '#6B7280',
    description: 'Tasks that need to be done but are not yet prioritized',
  },
  {
    name: 'Todo',
    category: 'not_started',
    color: '#9CA3AF',
    description: 'Tasks ready to be worked on',
  },

  // In Progress category
  {
    name: 'In Progress',
    category: 'in_progress',
    color: '#3B82F6',
    description: 'Tasks currently being worked on',
  },
  {
    name: 'In Review',
    category: 'in_progress',
    color: '#8B5CF6',
    description: 'Tasks awaiting review or approval',
  },

  // Done category
  {
    name: 'Done',
    category: 'done',
    color: '#10B981',
    description: 'Tasks that have been completed',
  },

  // Cancelled category
  {
    name: 'Cancelled',
    category: 'cancelled',
    color: '#EF4444',
    description: 'Tasks that will not be completed',
  },
];

/**
 * Default statuses that should be marked as default for their category.
 */
export const DEFAULT_STATUS_NAMES_BY_CATEGORY: Record<TaskStatusCategory, string> = {
  not_started: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};
