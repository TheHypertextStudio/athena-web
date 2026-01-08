/**
 * Task Zod schemas.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  idSchema,
  timestampSchema,
  optionalTimestampSchema,
  successResponse,
  listResponse,
} from './common.js';

/**
 * Task status enum.
 */
export const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);

/**
 * Task priority enum.
 */
export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

/**
 * Base task schema.
 */
export const taskSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(500),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  deadline: timestampSchema.nullable(),
  estimatedMinutes: z.number().int().positive().nullable(),
  projectId: idSchema.nullable(),
  assigneeId: idSchema.nullable(),
  creatorId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * Tag reference schema.
 */
export const tagRefSchema = z.object({
  id: idSchema,
  name: z.string(),
  color: z.string().nullable(),
});

/**
 * User reference schema.
 */
export const userRefSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.email(),
});

/**
 * Task with relations.
 */
export const taskWithRelationsSchema = taskSchema.extend({
  project: z.object({ id: idSchema, name: z.string() }).nullable().optional(),
  assignee: userRefSchema.nullable().optional(),
  creator: userRefSchema.optional(),
  tags: z.array(z.object({ tag: tagRefSchema })).optional(),
});

/**
 * Create task request.
 */
export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  deadline: z.iso.datetime().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  projectId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  tagIds: z.array(idSchema).optional(),
});

/**
 * Update task request.
 */
export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  deadline: optionalTimestampSchema,
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  projectId: idSchema.nullable().optional(),
  assigneeId: idSchema.nullable().optional(),
  tagIds: z.array(idSchema).optional(),
});

/**
 * Task query parameters.
 */
export const taskQuerySchema = z.object({
  projectId: idSchema.optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: idSchema.optional(),
});

/**
 * Task response.
 */
export const taskResponseSchema = successResponse(taskWithRelationsSchema);

/**
 * Task list response.
 */
export const taskListResponseSchema = listResponse(taskWithRelationsSchema);

export type Task = z.infer<typeof taskSchema>;
export type TaskWithRelations = z.infer<typeof taskWithRelationsSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
