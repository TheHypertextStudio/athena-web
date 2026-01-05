/**
 * Initiative Zod schemas.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { idSchema, timestampSchema, successResponse, listResponse } from './common.js';

/**
 * Initiative status enum.
 */
export const initiativeStatusSchema = z.enum(['draft', 'active', 'completed', 'archived']);

/**
 * Base initiative schema.
 */
export const initiativeSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(255),
  description: z.string().nullable(),
  status: initiativeStatusSchema,
  parentId: idSchema.nullable(),
  ownerId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * Initiative with relations.
 */
export const initiativeWithRelationsSchema = initiativeSchema.extend({
  parent: initiativeSchema.nullable().optional(),
  children: z.array(initiativeSchema).optional(),
  projects: z.array(z.object({ id: idSchema, name: z.string() })).optional(),
});

/**
 * Create initiative request.
 */
export const createInitiativeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  status: initiativeStatusSchema.optional(),
  parentId: idSchema.optional(),
});

/**
 * Update initiative request.
 */
export const updateInitiativeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: initiativeStatusSchema.optional(),
  parentId: idSchema.nullable().optional(),
});

/**
 * Initiative response.
 */
export const initiativeResponseSchema = successResponse(initiativeWithRelationsSchema);

/**
 * Initiative list response.
 */
export const initiativeListResponseSchema = listResponse(initiativeWithRelationsSchema);

export type Initiative = z.infer<typeof initiativeSchema>;
export type InitiativeWithRelations = z.infer<typeof initiativeWithRelationsSchema>;
export type CreateInitiativeInput = z.infer<typeof createInitiativeSchema>;
export type UpdateInitiativeInput = z.infer<typeof updateInitiativeSchema>;
