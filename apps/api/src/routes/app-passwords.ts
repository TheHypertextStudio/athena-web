/**
 * App password management routes.
 *
 * Users create app-specific passwords to connect native calendar apps
 * (iOS Calendar, macOS Calendar.app, etc.) to Athena via CalDAV.
 *
 * @packageDocumentation
 */

import { createRoute, z } from '@hono/zod-openapi';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { appPasswords } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import * as crypto from 'node:crypto';
import { hashPassword, generateAppPassword } from '../services/caldav-server/index.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import {
  AppPasswordSchema,
  AppPasswordWithSecretSchema,
  CreateAppPasswordSchema,
} from './app-passwords/schemas.js';
import { toAppPassword } from './app-passwords/serializers.js';

const appPasswordRoutes = createOpenAPIApp();

// Apply auth to all routes
appPasswordRoutes.use('*', requireAuth);

// ============================================================================
// Routes
// ============================================================================

/**
 * List app passwords.
 */
const listRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List app passwords',
  description:
    'Returns all app passwords for the authenticated user. Password hashes are never returned.',
  tags: ['App Passwords'],
  responses: {
    200: {
      description: 'List of app passwords',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(AppPasswordSchema),
          }),
        },
      },
    },
  },
});

appPasswordRoutes.openapi(listRoute, async (c) => {
  const userId = getUserId(c);

  const passwords = await db.query.appPasswords.findMany({
    where: eq(appPasswords.userId, userId),
    columns: {
      id: true,
      name: true,
      scopes: true,
      lastUsedAt: true,
      lastUsedIp: true,
      expiresAt: true,
      createdAt: true,
      // Explicitly exclude passwordHash
    },
    orderBy: (t, { desc }) => desc(t.createdAt),
  });

  return c.json({ data: passwords.map(toAppPassword) });
});

/**
 * Create app password.
 */
const createPasswordRoute = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create app password',
  description:
    'Creates a new app password. The password is returned in the response and will never be shown again.',
  tags: ['App Passwords'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateAppPasswordSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'App password created successfully',
      content: {
        'application/json': {
          schema: z.object({
            data: AppPasswordWithSecretSchema,
          }),
        },
      },
    },
    400: {
      description: 'Invalid input',
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
  },
});

appPasswordRoutes.openapi(createPasswordRoute, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  // Generate a random password
  const plainPassword = generateAppPassword();
  const passwordHash = await hashPassword(plainPassword);

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(appPasswords).values({
    id,
    userId,
    name: body.name,
    passwordHash,
    scopes: body.scopes,
    expiresAt: body.expiresAt ?? null,
    createdAt: now,
  });

  return c.json(
    {
      data: {
        ...toAppPassword({
          id,
          name: body.name,
          scopes: body.scopes,
          lastUsedAt: null,
          lastUsedIp: null,
          expiresAt: body.expiresAt ?? null,
          createdAt: now,
        }),
        password: plainPassword, // Only returned on creation
      },
    },
    201,
  );
});

/**
 * Update app password name.
 */
const updateRoute = createRoute({
  method: 'patch',
  path: '/:id',
  summary: 'Update app password',
  description: 'Updates the name of an app password.',
  tags: ['App Passwords'],
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(100),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'App password updated',
      content: {
        'application/json': {
          schema: z.object({
            data: AppPasswordSchema,
          }),
        },
      },
    },
    404: {
      description: 'App password not found',
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
  },
});

appPasswordRoutes.openapi(updateRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const { name } = c.req.valid('json');

  const result = await db
    .update(appPasswords)
    .set({ name })
    .where(and(eq(appPasswords.id, id), eq(appPasswords.userId, userId)))
    .returning({
      id: appPasswords.id,
      name: appPasswords.name,
      scopes: appPasswords.scopes,
      lastUsedAt: appPasswords.lastUsedAt,
      lastUsedIp: appPasswords.lastUsedIp,
      expiresAt: appPasswords.expiresAt,
      createdAt: appPasswords.createdAt,
    });

  if (result.length === 0) {
    return c.json({ error: 'App password not found' }, 404);
  }

  const p = result[0];
  if (!p) {
    return c.json({ error: 'App password not found' }, 404);
  }
  return c.json({ data: toAppPassword(p) }, 200);
});

/**
 * Delete app password.
 */
const deleteRoute = createRoute({
  method: 'delete',
  path: '/:id',
  summary: 'Delete app password',
  description:
    'Revokes an app password. The device using this password will immediately lose access.',
  tags: ['App Passwords'],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'App password deleted',
      content: {
        'application/json': {
          schema: z.object({
            data: z.object({
              deleted: z.boolean(),
            }),
          }),
        },
      },
    },
    404: {
      description: 'App password not found',
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
  },
});

appPasswordRoutes.openapi(deleteRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db
    .delete(appPasswords)
    .where(and(eq(appPasswords.id, id), eq(appPasswords.userId, userId)))
    .returning({ id: appPasswords.id });

  if (result.length === 0) {
    return c.json({ error: 'App password not found' }, 404);
  }

  return c.json({ data: { deleted: true } }, 200);
});

export { appPasswordRoutes };
