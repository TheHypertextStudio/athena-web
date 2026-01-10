/**
 * Project OpenAPI schemas.
 *
 * These schemas define the API contract for project endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema, listResponseSchema } from './common.js';
import { UserRefSchema } from './tasks.js';
import { InitiativeRefSchema } from './initiatives.js';

// =============================================================================
// Enums
// =============================================================================

export const ProjectStatusSchema = z
  .enum(['planning', 'active', 'on_hold', 'completed', 'cancelled'])
  .openapi({
    description: 'Project status',
    example: 'active',
  });

// =============================================================================
// Core Project Schemas
// =============================================================================

export const ProjectSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Project UUID' }),
    name: z.string().min(1).max(500).openapi({
      description: 'Project name',
      example: 'Website Redesign',
    }),
    description: z.string().nullable().openapi({
      description: 'Project description',
      example: 'Complete redesign of the marketing website',
    }),
    status: ProjectStatusSchema,
    deadline: TimestampSchema.nullable().openapi({
      description: 'Project deadline',
      example: '2025-03-01T00:00:00Z',
    }),
    initiativeId: z.uuid().nullable().openapi({ description: 'Parent initiative UUID' }),
    ownerId: z.uuid().openapi({ description: 'Owner user UUID' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('Project');

export const ProjectWithRelationsSchema = ProjectSchema.extend({
  initiative: InitiativeRefSchema.nullable().optional().openapi({
    description: 'Parent initiative details',
  }),
  owner: UserRefSchema.optional().openapi({
    description: 'Project owner details',
  }),
  taskCount: z.number().int().optional().openapi({
    description: 'Number of tasks in the project',
  }),
}).openapi('ProjectWithRelations');

export const ProjectDependencySchema = z
  .object({
    id: z.uuid().openapi({ description: 'Dependency UUID' }),
    projectId: z.uuid().openapi({ description: 'Project UUID' }),
    dependsOnProjectId: z.uuid().openapi({ description: 'Depends on project UUID' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
  })
  .openapi('ProjectDependency');

// =============================================================================
// Path Parameters
// =============================================================================

export const ProjectIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      description: 'Project UUID',
      example: '123e4567-e89b-12d3-a456-426614174000',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('ProjectIdParam');

export const ProjectDependencyParamsSchema = z
  .object({
    id: z.uuid().openapi({
      description: 'Project UUID',
      param: { name: 'id', in: 'path' },
    }),
    dependsOnId: z.uuid().openapi({
      description: 'Dependency project UUID',
      param: { name: 'dependsOnId', in: 'path' },
    }),
  })
  .openapi('ProjectDependencyParams');

// =============================================================================
// Query Parameters
// =============================================================================

export const ListProjectsQuerySchema = z
  .object({
    initiativeId: z
      .uuid()
      .optional()
      .openapi({
        description: 'Filter by initiative',
        param: { name: 'initiativeId', in: 'query' },
      }),
    status: ProjectStatusSchema.optional().openapi({
      description: 'Filter by status',
      param: { name: 'status', in: 'query' },
    }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .openapi({
        description: 'Maximum number of projects to return',
        example: 50,
        param: { name: 'limit', in: 'query' },
      }),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .openapi({
        description: 'Number of projects to skip',
        example: 0,
        param: { name: 'offset', in: 'query' },
      }),
  })
  .openapi('ListProjectsQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateProjectRequestSchema = z
  .object({
    name: z.string().min(1).max(500).openapi({
      description: 'Project name',
      example: 'Website Redesign',
    }),
    description: z.string().max(10000).optional().openapi({
      description: 'Project description',
    }),
    status: ProjectStatusSchema.default('planning').openapi({
      description: 'Initial project status',
    }),
    deadline: z.coerce.date().optional().openapi({
      description: 'Project deadline (ISO 8601)',
      example: '2025-03-01T00:00:00Z',
    }),
    initiativeId: z.uuid().optional().openapi({
      description: 'Parent initiative UUID',
    }),
  })
  .openapi('CreateProjectRequest');

export const UpdateProjectRequestSchema = z
  .object({
    name: z.string().min(1).max(500).optional().openapi({
      description: 'Project name',
    }),
    description: z.string().max(10000).nullish().openapi({
      description: 'Project description (null to clear)',
    }),
    status: ProjectStatusSchema.optional().openapi({
      description: 'Project status',
    }),
    deadline: z.coerce.date().nullish().openapi({
      description: 'Project deadline (null to clear)',
    }),
    initiativeId: z.uuid().nullish().openapi({
      description: 'Parent initiative UUID (null to clear)',
    }),
  })
  .openapi('UpdateProjectRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const ProjectResponseSchema = successResponseSchema(
  ProjectWithRelationsSchema,
  'Project response',
).openapi('ProjectResponse');

export const ProjectListResponseSchema = listResponseSchema(
  ProjectWithRelationsSchema,
  'Project list response',
).openapi('ProjectListResponse');

export const ProjectDependenciesResponseSchema = listResponseSchema(
  ProjectDependencySchema,
  'Project dependencies response',
).openapi('ProjectDependenciesResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectWithRelations = z.infer<typeof ProjectWithRelationsSchema>;
export type ProjectDependency = z.infer<typeof ProjectDependencySchema>;
export type ProjectIdParam = z.infer<typeof ProjectIdParamSchema>;
export type ProjectDependencyParams = z.infer<typeof ProjectDependencyParamsSchema>;
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
export type ProjectDependenciesResponse = z.infer<typeof ProjectDependenciesResponseSchema>;
