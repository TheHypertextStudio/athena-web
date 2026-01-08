/**
 * Project Zod schemas.
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
 * Project status enum.
 */
export const projectStatusSchema = z.enum([
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]);

/**
 * Base project schema.
 */
export const projectSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(255),
  description: z.string().nullable(),
  status: projectStatusSchema,
  deadline: timestampSchema.nullable(),
  initiativeId: idSchema.nullable(),
  ownerId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * Project with relations.
 */
export const projectWithRelationsSchema = projectSchema.extend({
  initiative: z.object({ id: idSchema, name: z.string() }).nullable().optional(),
  tasks: z.array(z.object({ id: idSchema, title: z.string(), status: z.string() })).optional(),
});

/**
 * Create project request.
 */
export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  status: projectStatusSchema.optional(),
  deadline: z.iso.datetime().optional(),
  initiativeId: idSchema.optional(),
});

/**
 * Update project request.
 */
export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: projectStatusSchema.optional(),
  deadline: optionalTimestampSchema,
  initiativeId: idSchema.nullable().optional(),
});

/**
 * Project query parameters.
 */
export const projectQuerySchema = z.object({
  initiativeId: idSchema.optional(),
});

/**
 * Project response.
 */
export const projectResponseSchema = successResponse(projectWithRelationsSchema);

/**
 * Project list response.
 */
export const projectListResponseSchema = listResponse(projectWithRelationsSchema);

export type Project = z.infer<typeof projectSchema>;
export type ProjectWithRelations = z.infer<typeof projectWithRelationsSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
