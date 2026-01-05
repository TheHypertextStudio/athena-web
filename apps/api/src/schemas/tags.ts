/**
 * Tag Zod schemas.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { idSchema, timestampSchema, successResponse, listResponse } from './common.js';

/**
 * Hex color regex pattern.
 */
const hexColorPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

/**
 * Base tag schema.
 */
export const tagSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(50),
  color: z.string().regex(hexColorPattern).nullable(),
  ownerId: idSchema,
  createdAt: timestampSchema,
});

/**
 * Tag with task count.
 */
export const tagWithTasksSchema = tagSchema.extend({
  tasks: z
    .array(
      z.object({
        task: z.object({
          id: idSchema,
          title: z.string(),
        }),
      }),
    )
    .optional(),
});

/**
 * Create tag request.
 */
export const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(hexColorPattern, 'Invalid hex color format').optional(),
});

/**
 * Update tag request.
 */
export const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(hexColorPattern, 'Invalid hex color format').nullable().optional(),
});

/**
 * Tag response.
 */
export const tagResponseSchema = successResponse(tagWithTasksSchema);

/**
 * Tag list response.
 */
export const tagListResponseSchema = listResponse(tagWithTasksSchema);

export type Tag = z.infer<typeof tagSchema>;
export type TagWithTasks = z.infer<typeof tagWithTasksSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
