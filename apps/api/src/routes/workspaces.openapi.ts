/**
 * Workspaces OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  WorkspaceIdParamSchema,
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceRequestSchema,
  WorkspacesResponseSchema,
  WorkspaceResponseSchema,
} from '@athena/types/openapi/workspaces';
import { NotFoundErrorSchema, UnauthorizedErrorSchema } from '@athena/types/openapi/common';

// =============================================================================
// List Workspaces
// =============================================================================

export const listWorkspaces = createRoute({
  method: 'get',
  path: '/',
  tags: ['Workspaces'],
  summary: 'List workspaces',
  description: 'List all workspaces for the authenticated user.',
  responses: {
    200: {
      description: 'Workspaces retrieved successfully',
      content: {
        'application/json': {
          schema: WorkspacesResponseSchema,
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
// Get Workspace
// =============================================================================

export const getWorkspace = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Workspaces'],
  summary: 'Get workspace',
  description: 'Get a workspace by ID.',
  request: {
    params: WorkspaceIdParamSchema,
  },
  responses: {
    200: {
      description: 'Workspace retrieved successfully',
      content: {
        'application/json': {
          schema: WorkspaceResponseSchema,
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
      description: 'Workspace not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Workspace
// =============================================================================

export const createWorkspace = createRoute({
  method: 'post',
  path: '/',
  tags: ['Workspaces'],
  summary: 'Create workspace',
  description: 'Create a new workspace.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateWorkspaceRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Workspace created successfully',
      content: {
        'application/json': {
          schema: WorkspaceResponseSchema,
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
// Update Workspace
// =============================================================================

export const updateWorkspace = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Workspaces'],
  summary: 'Update workspace',
  description: 'Update a workspace.',
  request: {
    params: WorkspaceIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateWorkspaceRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Workspace updated successfully',
      content: {
        'application/json': {
          schema: WorkspaceResponseSchema,
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
      description: 'Workspace not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Workspace
// =============================================================================

export const deleteWorkspace = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Workspaces'],
  summary: 'Delete workspace',
  description: 'Delete a workspace.',
  request: {
    params: WorkspaceIdParamSchema,
  },
  responses: {
    204: {
      description: 'Workspace deleted successfully',
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
      description: 'Workspace not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
