/**
 * Initiative Status OpenAPI schemas.
 *
 * These schemas define the API contract for custom initiative status endpoints.
 * Custom statuses allow users to define their own workflow states
 * while mapping to system-defined categories for filtering, reporting, and sync.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema, listResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

/**
 * System-defined initiative status categories.
 * Custom statuses must map to one of these categories.
 * These are immutable and used for:
 * - Filtering (show all "active" regardless of custom name)
 * - Reporting (aggregate by category)
 * - AI planning prioritization
 */
export const InitiativeStatusCategorySchema = z
  .enum(['planning', 'active', 'completed', 'archived'])
  .openapi({
    description: 'System-defined initiative status category',
    example: 'active',
  });

// =============================================================================
// Core Initiative Status Schemas
// =============================================================================

/**
 * Custom initiative status schema.
 * Represents a user-defined status that maps to a system category.
 */
export const CustomInitiativeStatusSchema = z
  .object({
    id: z.string().openapi({ description: 'Custom status ID' }),
    workspaceId: z.string().openapi({ description: 'Workspace ID this status belongs to' }),
    name: z.string().min(1).max(50).openapi({
      description: 'Display name for the status',
      example: 'In Progress',
    }),
    description: z.string().max(500).nullable().openapi({
      description: 'Optional description of what this status means',
      example: 'Initiative is actively being worked on',
    }),
    category: InitiativeStatusCategorySchema.openapi({
      description: 'System category this status maps to',
    }),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .openapi({
        description: 'Hex color code for UI display',
        example: '#3B82F6',
      }),
    icon: z.string().max(50).nullable().openapi({
      description: 'Optional icon identifier',
      example: 'rocket',
    }),
    position: z.number().int().min(0).openapi({
      description: 'Display order within the category (0 = first)',
      example: 1,
    }),
    isDefault: z.boolean().openapi({
      description: 'Whether this is the default status for its category when creating initiatives',
      example: false,
    }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('CustomInitiativeStatus');

/**
 * Compact status reference for use in initiative responses.
 */
export const InitiativeStatusRefSchema = z
  .object({
    id: z.string().openapi({ description: 'Custom status ID' }),
    name: z.string().openapi({ description: 'Status display name', example: 'Active' }),
    category: InitiativeStatusCategorySchema,
    color: z.string().openapi({ description: 'Status color', example: '#3B82F6' }),
  })
  .openapi('InitiativeStatusRef');

// =============================================================================
// Path Parameters
// =============================================================================

export const InitiativeStatusIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Custom initiative status ID',
      example: 'init_status_abc123',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('InitiativeStatusIdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const ListInitiativeStatusesQuerySchema = z
  .object({
    category: InitiativeStatusCategorySchema.optional().openapi({
      description: 'Filter by category',
      param: { name: 'category', in: 'query' },
    }),
    workspaceId: z
      .string()
      .optional()
      .openapi({
        description: 'Filter by workspace (defaults to user default workspace)',
        param: { name: 'workspaceId', in: 'query' },
      }),
  })
  .openapi('ListInitiativeStatusesQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateInitiativeStatusRequestSchema = z
  .object({
    name: z.string().min(1).max(50).openapi({
      description: 'Display name for the status',
      example: 'On Hold',
    }),
    description: z.string().max(500).optional().openapi({
      description: 'Optional description',
      example: 'Initiative is paused temporarily',
    }),
    category: InitiativeStatusCategorySchema.openapi({
      description: 'System category this status maps to',
    }),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .openapi({
        description: 'Hex color code for UI display',
        example: '#F59E0B',
      }),
    icon: z.string().max(50).optional().openapi({
      description: 'Optional icon identifier',
    }),
    workspaceId: z.string().optional().openapi({
      description: 'Workspace ID (defaults to user default workspace)',
    }),
  })
  .openapi('CreateInitiativeStatusRequest');

export const UpdateInitiativeStatusRequestSchema = z
  .object({
    name: z.string().min(1).max(50).optional().openapi({
      description: 'Display name for the status',
    }),
    description: z.string().max(500).nullish().openapi({
      description: 'Optional description (null to clear)',
    }),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional()
      .openapi({
        description: 'Hex color code',
      }),
    icon: z.string().max(50).nullish().openapi({
      description: 'Icon identifier (null to clear)',
    }),
  })
  .openapi('UpdateInitiativeStatusRequest');

export const ReorderInitiativeStatusesRequestSchema = z
  .object({
    category: InitiativeStatusCategorySchema.openapi({
      description: 'Category to reorder statuses within',
    }),
    statusIds: z
      .array(z.string())
      .min(1)
      .openapi({
        description: 'Status IDs in desired order',
        example: ['status-1', 'status-2', 'status-3'],
      }),
    workspaceId: z.string().optional().openapi({
      description: 'Workspace ID (defaults to user default workspace)',
    }),
  })
  .openapi('ReorderInitiativeStatusesRequest');

export const SetDefaultInitiativeStatusRequestSchema = z
  .object({
    workspaceId: z.string().optional().openapi({
      description: 'Workspace ID (defaults to user default workspace)',
    }),
  })
  .openapi('SetDefaultInitiativeStatusRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const InitiativeStatusResponseSchema = successResponseSchema(
  CustomInitiativeStatusSchema,
  'Initiative status response',
).openapi('InitiativeStatusResponse');

export const InitiativeStatusListResponseSchema = listResponseSchema(
  CustomInitiativeStatusSchema,
  'Initiative status list response',
).openapi('InitiativeStatusListResponse');

/**
 * Grouped statuses by category - useful for UI that shows statuses in columns.
 */
export const GroupedInitiativeStatusesSchema = z
  .object({
    planning: z.array(CustomInitiativeStatusSchema).openapi({
      description: 'Statuses in the "planning" category',
    }),
    active: z.array(CustomInitiativeStatusSchema).openapi({
      description: 'Statuses in the "active" category',
    }),
    completed: z.array(CustomInitiativeStatusSchema).openapi({
      description: 'Statuses in the "completed" category',
    }),
    archived: z.array(CustomInitiativeStatusSchema).openapi({
      description: 'Statuses in the "archived" category',
    }),
  })
  .openapi('GroupedInitiativeStatuses');

export const GroupedInitiativeStatusesResponseSchema = successResponseSchema(
  GroupedInitiativeStatusesSchema,
  'Grouped initiative statuses response',
).openapi('GroupedInitiativeStatusesResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type InitiativeStatusCategory = z.infer<typeof InitiativeStatusCategorySchema>;
export type CustomInitiativeStatus = z.infer<typeof CustomInitiativeStatusSchema>;
export type InitiativeStatusRef = z.infer<typeof InitiativeStatusRefSchema>;
export type InitiativeStatusIdParam = z.infer<typeof InitiativeStatusIdParamSchema>;
export type ListInitiativeStatusesQuery = z.infer<typeof ListInitiativeStatusesQuerySchema>;
export type CreateInitiativeStatusRequest = z.infer<typeof CreateInitiativeStatusRequestSchema>;
export type UpdateInitiativeStatusRequest = z.infer<typeof UpdateInitiativeStatusRequestSchema>;
export type ReorderInitiativeStatusesRequest = z.infer<
  typeof ReorderInitiativeStatusesRequestSchema
>;
export type SetDefaultInitiativeStatusRequest = z.infer<
  typeof SetDefaultInitiativeStatusRequestSchema
>;
export type InitiativeStatusResponse = z.infer<typeof InitiativeStatusResponseSchema>;
export type InitiativeStatusListResponse = z.infer<typeof InitiativeStatusListResponseSchema>;
export type GroupedInitiativeStatuses = z.infer<typeof GroupedInitiativeStatusesSchema>;
export type GroupedInitiativeStatusesResponse = z.infer<
  typeof GroupedInitiativeStatusesResponseSchema
>;
