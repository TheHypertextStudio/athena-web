/**
 * Project OpenAPI route definitions.
 *
 * These route definitions are used with OpenAPIHono to provide:
 * - Type-safe request/response handling
 * - OpenAPI spec generation
 * - Scalar documentation
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  ProjectIdParamSchema,
  ProjectDependencyParamsSchema,
  ListProjectsQuerySchema,
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  ProjectResponseSchema,
  ProjectListResponseSchema,
  ProjectDependenciesResponseSchema,
} from '@athena/types/openapi/projects';
import {
  ErrorResponseSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// List Projects
// =============================================================================

export const listProjects = createRoute({
  method: 'get',
  path: '/',
  tags: ['Projects'],
  summary: 'List projects',
  description: 'Retrieve a list of projects with optional filtering and pagination.',
  request: {
    query: ListProjectsQuerySchema,
  },
  responses: {
    200: {
      description: 'Projects retrieved successfully',
      content: {
        'application/json': {
          schema: ProjectListResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Project
// =============================================================================

export const getProject = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Projects'],
  summary: 'Get a project',
  description: 'Retrieve a single project by its ID.',
  request: {
    params: ProjectIdParamSchema,
  },
  responses: {
    200: {
      description: 'Project retrieved successfully',
      content: {
        'application/json': {
          schema: ProjectResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Project
// =============================================================================

export const createProject = createRoute({
  method: 'post',
  path: '/',
  tags: ['Projects'],
  summary: 'Create a project',
  description: 'Create a new project.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateProjectRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Project created successfully',
      content: {
        'application/json': {
          schema: ProjectResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Project
// =============================================================================

export const updateProject = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Projects'],
  summary: 'Update a project',
  description: 'Update an existing project. Only provided fields will be updated.',
  request: {
    params: ProjectIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateProjectRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Project updated successfully',
      content: {
        'application/json': {
          schema: ProjectResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Project
// =============================================================================

export const deleteProject = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Projects'],
  summary: 'Delete a project',
  description: 'Delete a project by its ID.',
  request: {
    params: ProjectIdParamSchema,
  },
  responses: {
    204: {
      description: 'Project deleted successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Project Dependencies
// =============================================================================

export const getProjectDependencies = createRoute({
  method: 'get',
  path: '/{id}/dependencies',
  tags: ['Projects'],
  summary: 'Get project dependencies',
  description: 'Retrieve all projects that this project depends on.',
  request: {
    params: ProjectIdParamSchema,
  },
  responses: {
    200: {
      description: 'Dependencies retrieved successfully',
      content: {
        'application/json': {
          schema: ProjectDependenciesResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Add Project Dependency
// =============================================================================

export const addProjectDependency = createRoute({
  method: 'post',
  path: '/{id}/dependencies/{dependsOnId}',
  tags: ['Projects'],
  summary: 'Add project dependency',
  description: 'Add a dependency relationship between two projects.',
  request: {
    params: ProjectDependencyParamsSchema,
  },
  responses: {
    201: {
      description: 'Dependency added successfully',
    },
    400: {
      description: 'Invalid dependency (e.g., circular dependency)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Remove Project Dependency
// =============================================================================

export const removeProjectDependency = createRoute({
  method: 'delete',
  path: '/{id}/dependencies/{dependsOnId}',
  tags: ['Projects'],
  summary: 'Remove project dependency',
  description: 'Remove a dependency relationship between two projects.',
  request: {
    params: ProjectDependencyParamsSchema,
  },
  responses: {
    204: {
      description: 'Dependency removed successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project or dependency not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
