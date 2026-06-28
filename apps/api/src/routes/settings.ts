/**
 * User settings routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import {
  UpdateSettingsRequestSchema,
  SettingsResponseSchema,
} from '@athena/types/openapi/settings';
import { UnauthorizedErrorSchema, ValidationErrorSchema } from '@athena/types/openapi/common';
import { db } from '../db/index.js';
import { userSettings } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { toSettingsResponse } from './settings/serializers.js';

const settingsRoutes = createOpenAPIApp();

settingsRoutes.use('*', requireAuth);

const DEFAULT_TIMEZONE = 'UTC' as const;
const DEFAULT_ENCRYPTION_ENABLED = false as const;

// =============================================================================
// Get Settings
// =============================================================================

const getSettings = createRoute({
  method: 'get',
  path: '/',
  tags: ['Settings'],
  summary: 'Get user settings',
  description: "Retrieve the current user's settings.",
  responses: {
    200: {
      description: 'Settings retrieved successfully',
      content: {
        'application/json': {
          schema: SettingsResponseSchema,
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
// Update Settings
// =============================================================================

const updateSettings = createRoute({
  method: 'patch',
  path: '/',
  tags: ['Settings'],
  summary: 'Update user settings',
  description: "Update the current user's settings. Only provided fields will be updated.",
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdateSettingsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Settings updated successfully',
      content: {
        'application/json': {
          schema: SettingsResponseSchema,
        },
      },
    },
    201: {
      description: 'Settings created successfully',
      content: {
        'application/json': {
          schema: SettingsResponseSchema,
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

/**
 * Get current user's settings.
 * GET /api/settings
 */
settingsRoutes.openapi(getSettings, async (c) => {
  const userId = getUserId(c);

  const result = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });

  if (!result) {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(userSettings).values({
      id,
      userId,
      preferredName: null,
      timezone: DEFAULT_TIMEZONE,
      dailyPlanningTime: null,
      dailyReviewTime: null,
      encryptionEnabled: DEFAULT_ENCRYPTION_ENABLED,
      createdAt: now,
      updatedAt: now,
    });

    return c.json(
      {
        data: toSettingsResponse({
          id,
          userId,
          preferredName: null,
          timezone: DEFAULT_TIMEZONE,
          dailyPlanningTime: null,
          dailyReviewTime: null,
          encryptionEnabled: DEFAULT_ENCRYPTION_ENABLED,
          createdAt: now,
          updatedAt: now,
        }),
      },
      200,
    );
  }

  return c.json({ data: toSettingsResponse(result) }, 200);
});

/**
 * Update current user's settings.
 * PATCH /api/settings
 */
settingsRoutes.openapi(updateSettings, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const existing = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });

  if (!existing) {
    // Create settings if they don't exist
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(userSettings).values({
      id,
      userId,
      preferredName: body.preferredName,
      timezone: body.timezone ?? DEFAULT_TIMEZONE,
      dailyPlanningTime: body.dailyPlanningTime,
      dailyReviewTime: body.dailyReviewTime,
      encryptionEnabled: body.encryptionEnabled ?? DEFAULT_ENCRYPTION_ENABLED,
      createdAt: now,
      updatedAt: now,
    });

    const result = await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
    });

    if (!result) {
      throw new Error('Failed to create settings');
    }

    return c.json({ data: toSettingsResponse(result) }, 201);
  }

  const updateData: Partial<typeof userSettings.$inferInsert> = { updatedAt: new Date() };
  if (body.preferredName !== undefined) updateData.preferredName = body.preferredName;
  if (body.timezone !== undefined) updateData.timezone = body.timezone;
  if (body.dailyPlanningTime !== undefined) updateData.dailyPlanningTime = body.dailyPlanningTime;
  if (body.dailyReviewTime !== undefined) updateData.dailyReviewTime = body.dailyReviewTime;
  if (body.encryptionEnabled !== undefined) updateData.encryptionEnabled = body.encryptionEnabled;

  await db.update(userSettings).set(updateData).where(eq(userSettings.userId, userId));

  const result = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });

  if (!result) {
    throw new Error('Failed to update settings');
  }

  return c.json({ data: toSettingsResponse(result) }, 200);
});

export { settingsRoutes };
