/**
 * Initiative OpenAPI schemas.
 *
 * These schemas define the API contract for initiative endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema, listResponseSchema } from './common.js';
import { UserRefSchema } from './tasks.js';

// =============================================================================
// Enums
// =============================================================================

export const InitiativeStatusSchema = z.enum(['draft', 'active', 'completed', 'archived']).openapi({
  description: 'Initiative status',
  example: 'active',
});

// =============================================================================
// Core Initiative Schemas
// =============================================================================

export const InitiativeSchema = z
  .object({
    id: z.string().min(1).openapi({ description: 'Initiative ID' }),
    name: z.string().min(1).max(500).openapi({
      description: 'Initiative name',
      example: 'Q1 2025 Goals',
    }),
    description: z.string().nullable().openapi({
      description: 'Initiative description',
      example: 'Key objectives for the first quarter',
    }),
    status: InitiativeStatusSchema,
    parentId: z.string().min(1).nullable().openapi({
      description: 'Parent initiative ID for hierarchical initiatives',
    }),
    ownerId: z.uuid().openapi({ description: 'Owner user UUID' }),
    deletedAt: TimestampSchema.nullable().openapi({
      description: 'Soft delete timestamp',
    }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('Initiative');

// Forward declare for recursive relations
export const InitiativeRefSchema = z
  .object({
    id: z.string().min(1).openapi({ description: 'Initiative ID' }),
    name: z.string().openapi({ description: 'Initiative name', example: 'Q1 Goals' }),
    status: InitiativeStatusSchema,
  })
  .openapi('InitiativeRefDetailed');

export const InitiativeProjectSchema = z
  .object({
    id: z.string().min(1).openapi({ description: 'Project ID' }),
    name: z.string().optional().openapi({ description: 'Project name' }),
    tasks: z.array(z.unknown()).optional().openapi({ description: 'Project tasks' }),
  })
  .openapi('InitiativeProject');

export const InitiativeWithRelationsSchema = InitiativeSchema.extend({
  parent: InitiativeRefSchema.nullable().optional().openapi({
    description: 'Parent initiative details',
  }),
  owner: UserRefSchema.optional().openapi({
    description: 'Initiative owner details',
  }),
  children: z.array(InitiativeRefSchema).optional().openapi({
    description: 'Child initiative summaries',
  }),
  projects: z.array(InitiativeProjectSchema).optional().openapi({
    description: 'Projects in this initiative',
  }),
  projectCount: z.number().int().optional().openapi({
    description: 'Number of projects in this initiative',
  }),
}).openapi('InitiativeWithRelations');

// =============================================================================
// Path Parameters
// =============================================================================

export const InitiativeIdParamSchema = z
  .object({
    id: z.string().min(1).openapi({
      description: 'Initiative ID',
      example: 'initiative-123',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('InitiativeIdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const ListInitiativesQuerySchema = z
  .object({
    status: InitiativeStatusSchema.optional().openapi({
      description: 'Filter by status',
      param: { name: 'status', in: 'query' },
    }),
    parentId: z
      .string()
      .min(1)
      .optional()
      .openapi({
        description: 'Filter by parent initiative',
        param: { name: 'parentId', in: 'query' },
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .openapi({
        description: 'Maximum number of initiatives to return',
        example: 50,
        param: { name: 'limit', in: 'query' },
      }),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .openapi({
        description: 'Number of initiatives to skip',
        example: 0,
        param: { name: 'offset', in: 'query' },
      }),
  })
  .openapi('ListInitiativesQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateInitiativeRequestSchema = z
  .object({
    name: z.string().min(1).max(500).openapi({
      description: 'Initiative name',
      example: 'Q1 2025 Goals',
    }),
    description: z.string().max(10000).optional().openapi({
      description: 'Initiative description',
    }),
    status: InitiativeStatusSchema.default('draft').openapi({
      description: 'Initial initiative status',
    }),
    parentId: z.string().min(1).optional().openapi({
      description: 'Parent initiative ID for hierarchical initiatives',
    }),
  })
  .openapi('CreateInitiativeRequest');

export const UpdateInitiativeRequestSchema = z
  .object({
    name: z.string().min(1).max(500).optional().openapi({
      description: 'Initiative name',
    }),
    description: z.string().max(10000).nullish().openapi({
      description: 'Initiative description (null to clear)',
    }),
    status: InitiativeStatusSchema.optional().openapi({
      description: 'Initiative status',
    }),
    parentId: z.string().min(1).nullish().openapi({
      description: 'Parent initiative ID (null to clear)',
    }),
  })
  .openapi('UpdateInitiativeRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const InitiativeResponseSchema = successResponseSchema(
  InitiativeWithRelationsSchema,
  'Initiative response',
).openapi('InitiativeResponse');

export const InitiativeListResponseSchema = listResponseSchema(
  InitiativeWithRelationsSchema,
  'Initiative list response',
).openapi('InitiativeListResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type InitiativeStatus = z.infer<typeof InitiativeStatusSchema>;
export type Initiative = z.infer<typeof InitiativeSchema>;
export type InitiativeRef = z.infer<typeof InitiativeRefSchema>;
export type InitiativeWithRelations = z.infer<typeof InitiativeWithRelationsSchema>;
export type InitiativeIdParam = z.infer<typeof InitiativeIdParamSchema>;
export type ListInitiativesQuery = z.infer<typeof ListInitiativesQuerySchema>;
export type CreateInitiativeRequest = z.infer<typeof CreateInitiativeRequestSchema>;
export type UpdateInitiativeRequest = z.infer<typeof UpdateInitiativeRequestSchema>;
export type InitiativeResponse = z.infer<typeof InitiativeResponseSchema>;
export type InitiativeListResponse = z.infer<typeof InitiativeListResponseSchema>;
