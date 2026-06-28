/**
 * Tag routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  TagIdParamSchema,
  CreateTagRequestSchema,
  UpdateTagRequestSchema,
  TagResponseSchema,
  TagsResponseSchema,
} from '@athena/types/openapi/tags';
import {
  ErrorResponseSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tags } from '../db/schema/index.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { toTagWithTasks } from './tags/serializers.js';

const tagRoutes = createOpenAPIApp();

tagRoutes.use('*', requireAuth);

const ERROR_TAG_NOT_FOUND = 'Tag not found';

// =============================================================================
// OpenAPI Route Definitions
// =============================================================================

const listTags = createRoute({
  method: 'get',
  path: '/',
  tags: ['Tags'],
  summary: 'List tags',
  description: 'List all tags for the authenticated user.',
  responses: {
    200: {
      description: 'Tags retrieved successfully',
      content: {
        'application/json': {
          schema: TagsResponseSchema,
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

const getTag = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Tags'],
  summary: 'Get tag',
  description: 'Get a tag by ID.',
  request: {
    params: TagIdParamSchema,
  },
  responses: {
    200: {
      description: 'Tag retrieved successfully',
      content: {
        'application/json': {
          schema: TagResponseSchema,
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
      description: 'Tag not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const createTag = createRoute({
  method: 'post',
  path: '/',
  tags: ['Tags'],
  summary: 'Create tag',
  description: 'Create a new tag.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTagRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Tag created successfully',
      content: {
        'application/json': {
          schema: TagResponseSchema,
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

const updateTag = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Tags'],
  summary: 'Update tag',
  description: 'Update a tag.',
  request: {
    params: TagIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateTagRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tag updated successfully',
      content: {
        'application/json': {
          schema: TagResponseSchema,
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
      description: 'Tag not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const deleteTag = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Tags'],
  summary: 'Delete tag',
  description: 'Delete a tag.',
  request: {
    params: TagIdParamSchema,
  },
  responses: {
    204: {
      description: 'Tag deleted successfully',
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
      description: 'Tag not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * List all tags for the authenticated user.
 * GET /api/tags
 */
tagRoutes.openapi(listTags, async (c) => {
  const userId = getUserId(c);

  const result = await db.query.tags.findMany({
    where: eq(tags.ownerId, userId),
    with: {
      tasks: {
        with: {
          task: true,
        },
      },
    },
    orderBy: (tags, { asc }) => [asc(tags.name)],
  });

  return c.json({ data: result.map(toTagWithTasks) }, 200);
});

/**
 * Get a single tag by ID.
 * GET /api/tags/:id
 */
tagRoutes.openapi(getTag, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.tags.findFirst({
    where: and(eq(tags.id, id), eq(tags.ownerId, userId)),
    with: {
      tasks: {
        with: {
          task: true,
        },
      },
    },
  });

  if (!result) {
    return c.json({ error: ERROR_TAG_NOT_FOUND }, 404);
  }

  return c.json({ data: toTagWithTasks(result) }, 200);
});

/**
 * Create a new tag.
 * POST /api/tags
 */
tagRoutes.openapi(createTag, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(tags).values({
    id,
    name: body.name,
    color: body.color,
    ownerId: userId,
    createdAt: now,
  });

  const result = await db.query.tags.findFirst({
    where: eq(tags.id, id),
    with: {
      tasks: {
        with: {
          task: true,
        },
      },
    },
  });

  if (!result) {
    throw new Error('Failed to create tag');
  }

  return c.json({ data: toTagWithTasks(result) }, 201);
});

/**
 * Update a tag.
 * PATCH /api/tags/:id
 */
tagRoutes.openapi(updateTag, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.tags.findFirst({
    where: and(eq(tags.id, id), eq(tags.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_TAG_NOT_FOUND }, 404);
  }

  const updateData: Partial<typeof tags.$inferInsert> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.color !== undefined) updateData.color = body.color;

  await db
    .update(tags)
    .set(updateData)
    .where(and(eq(tags.id, id), eq(tags.ownerId, userId)));

  const result = await db.query.tags.findFirst({
    where: eq(tags.id, id),
    with: {
      tasks: {
        with: {
          task: true,
        },
      },
    },
  });

  if (!result) {
    throw new Error('Failed to update tag');
  }

  return c.json({ data: toTagWithTasks(result) }, 200);
});

/**
 * Delete a tag.
 * DELETE /api/tags/:id
 */
tagRoutes.openapi(deleteTag, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const existing = await db.query.tags.findFirst({
    where: and(eq(tags.id, id), eq(tags.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_TAG_NOT_FOUND }, 404);
  }

  await db.delete(tags).where(and(eq(tags.id, id), eq(tags.ownerId, userId)));

  return c.body(null, 204);
});

export { tagRoutes };
