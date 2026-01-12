/**
 * Tags OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Core Tag Schemas
// =============================================================================

export const TagSchema = z
  .object({
    id: z.string().openapi({ description: 'Tag ID' }),
    name: z.string().openapi({ description: 'Tag name' }),
    color: z.string().nullable().openapi({ description: 'Tag color (hex)' }),
    ownerId: z.uuid().openapi({ description: 'Owner user ID' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
  })
  .openapi('Tag');

export const TagWithTasksSchema = TagSchema.extend({
  tasks: z
    .array(
      z.object({
        task: z
          .object({
            id: z.string(),
            title: z.string(),
            status: z.string(),
          })
          .nullable(),
      }),
    )
    .openapi({ description: 'Associated tasks' }),
}).openapi('TagWithTasks');

// =============================================================================
// Path Parameters
// =============================================================================

export const TagIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Tag ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('TagIdParam');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateTagRequestSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({ description: 'Tag name' }),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional()
      .openapi({ description: 'Tag color (hex)' }),
  })
  .openapi('CreateTagRequest');

export const UpdateTagRequestSchema = z
  .object({
    name: z.string().min(1).max(100).optional().openapi({ description: 'Tag name' }),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional()
      .openapi({ description: 'Tag color (hex)' }),
  })
  .openapi('UpdateTagRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const TagsResponseSchema = successResponseSchema(
  z.array(TagWithTasksSchema),
  'List of tags',
).openapi('TagsResponse');

export const TagResponseSchema = successResponseSchema(TagWithTasksSchema, 'Tag details').openapi(
  'TagResponse',
);

export const CreateTagResponseSchema = successResponseSchema(TagSchema, 'Created tag').openapi(
  'CreateTagResponse',
);

// =============================================================================
// Type Exports
// =============================================================================

export type Tag = z.infer<typeof TagSchema>;
export type TagWithTasks = z.infer<typeof TagWithTasksSchema>;
export type CreateTagRequest = z.infer<typeof CreateTagRequestSchema>;
export type UpdateTagRequest = z.infer<typeof UpdateTagRequestSchema>;
