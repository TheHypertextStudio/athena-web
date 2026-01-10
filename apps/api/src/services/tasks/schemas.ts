/**
 * Zod schemas for task operations.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

export const TaskStatus = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskPriority = z.enum(['low', 'medium', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const ListTasksInput = z.object({
  projectId: z.uuid().optional(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListTasksInput = z.infer<typeof ListTasksInput>;

export const CreateTaskInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  status: TaskStatus.default('pending'),
  priority: TaskPriority.default('medium'),
  deadline: z.coerce.date().optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
  projectId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  tagIds: z.array(z.uuid()).optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const UpdateTaskInput = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).nullish(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  deadline: z.coerce.date().nullish(),
  estimatedMinutes: z.number().int().min(0).nullish(),
  projectId: z.uuid().nullish(),
  assigneeId: z.uuid().nullish(),
  tagIds: z.array(z.uuid()).optional(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

export const TaskIdParam = z.object({
  id: z.uuid(),
});
export type TaskIdParam = z.infer<typeof TaskIdParam>;

export const TaskTagParams = z.object({
  taskId: z.uuid(),
  tagId: z.uuid(),
});
export type TaskTagParams = z.infer<typeof TaskTagParams>;

export const TaskDependencyParams = z.object({
  taskId: z.uuid(),
  dependsOnId: z.uuid(),
});
export type TaskDependencyParams = z.infer<typeof TaskDependencyParams>;
