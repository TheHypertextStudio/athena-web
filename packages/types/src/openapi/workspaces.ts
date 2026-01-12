/**
 * Workspaces OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Core Workspace Schemas
// =============================================================================

export const WorkspaceSchema = z
  .object({
    id: z.string().openapi({ description: 'Workspace ID' }),
    name: z.string().openapi({ description: 'Workspace name' }),
    description: z.string().nullable().openapi({ description: 'Workspace description' }),
    ownerId: z.uuid().openapi({ description: 'Owner user ID' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('Workspace');

// =============================================================================
// Path Parameters
// =============================================================================

export const WorkspaceIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Workspace ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('WorkspaceIdParam');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateWorkspaceRequestSchema = z
  .object({
    name: z.string().min(1).max(200).openapi({ description: 'Workspace name' }),
    description: z.string().max(2000).optional().openapi({ description: 'Workspace description' }),
  })
  .openapi('CreateWorkspaceRequest');

export const UpdateWorkspaceRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional().openapi({ description: 'Workspace name' }),
    description: z
      .string()
      .max(2000)
      .nullable()
      .optional()
      .openapi({ description: 'Workspace description' }),
  })
  .openapi('UpdateWorkspaceRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const WorkspacesResponseSchema = successResponseSchema(
  z.array(WorkspaceSchema),
  'List of workspaces',
).openapi('WorkspacesResponse');

export const WorkspaceResponseSchema = successResponseSchema(
  WorkspaceSchema,
  'Workspace details',
).openapi('WorkspaceResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequestSchema>;
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequestSchema>;
