/**
 * Workspace routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  WorkspaceIdParamSchema,
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceRequestSchema,
  WorkspaceResponseSchema,
  WorkspacesResponseSchema,
} from '@athena/types/openapi/workspaces';
import {
  ErrorResponseSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workspaces } from '../db/schema/index.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/entitlements.js';

const workspaceRoutes = createOpenAPIApp();

// Require authentication for all routes
workspaceRoutes.use('*', requireAuth);

// Require 'team_workspaces' entitlement for mutating operations (POST/PUT/DELETE)
// GET requests pass through (read access is sacred)
workspaceRoutes.use('*', requireEntitlement('team_workspaces'));

// =============================================================================
// OpenAPI Route Definitions
// =============================================================================

const listWorkspaces = createRoute({
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

const getWorkspace = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const createWorkspace = createRoute({
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

const updateWorkspace = createRoute({
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
      description: 'Workspace not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const deleteWorkspace = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * List all workspaces for the authenticated user.
 * GET /api/workspaces
 */
workspaceRoutes.openapi(listWorkspaces, async (c) => {
  const userId = getUserId(c);

  const result = await db.query.workspaces.findMany({
    where: eq(workspaces.ownerId, userId),
    orderBy: (workspaces, { desc }) => [desc(workspaces.createdAt)],
  });

  return c.json({ data: result }, 200);
});

/**
 * Get a single workspace by ID.
 * GET /api/workspaces/:id
 */
workspaceRoutes.openapi(getWorkspace, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)),
  });

  if (!result) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  return c.json({ data: result }, 200);
});

/**
 * Create a new workspace.
 * POST /api/workspaces
 */
workspaceRoutes.openapi(createWorkspace, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(workspaces).values({
    id,
    name: body.name,
    description: body.description,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, id),
  });

  if (!result) {
    throw new Error('Failed to create workspace');
  }

  return c.json({ data: result }, 201);
});

/**
 * Update a workspace.
 * PATCH /api/workspaces/:id
 */
workspaceRoutes.openapi(updateWorkspace, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  const updateData: Partial<typeof workspaces.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;

  await db
    .update(workspaces)
    .set(updateData)
    .where(and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)));

  const result = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, id),
  });

  if (!result) {
    throw new Error('Failed to update workspace');
  }

  return c.json({ data: result }, 200);
});

/**
 * Delete a workspace.
 * DELETE /api/workspaces/:id
 */
workspaceRoutes.openapi(deleteWorkspace, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const existing = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  await db.delete(workspaces).where(and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)));

  return c.body(null, 204);
});

export { workspaceRoutes };
