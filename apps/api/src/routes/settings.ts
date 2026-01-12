/**
 * User settings routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { userSettings } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const settingsRoutes = new Hono();

settingsRoutes.use('*', requireAuth);

const DEFAULT_TIMEZONE = 'UTC' as const;
const DEFAULT_ENCRYPTION_ENABLED = false as const;

/**
 * Get current user's settings.
 * GET /api/settings
 */
settingsRoutes.get('/', async (c) => {
  const userId = getUserId(c);

  const result = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });

  if (!result) {
    // Return default settings if none exist
    return c.json({
      data: {
        preferredName: null,
        timezone: DEFAULT_TIMEZONE,
        dailyPlanningTime: null,
        dailyReviewTime: null,
        encryptionEnabled: DEFAULT_ENCRYPTION_ENABLED,
      },
    });
  }

  return c.json({ data: result });
});

/**
 * Update current user's settings.
 * PATCH /api/settings
 */
settingsRoutes.patch('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    preferredName?: string | null;
    timezone?: string;
    dailyPlanningTime?: string | null;
    dailyReviewTime?: string | null;
    encryptionEnabled?: boolean;
  }>();

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

    return c.json({ data: result }, 201);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.preferredName !== undefined) updateData.preferredName = body.preferredName;
  if (body.timezone !== undefined) updateData.timezone = body.timezone;
  if (body.dailyPlanningTime !== undefined) updateData.dailyPlanningTime = body.dailyPlanningTime;
  if (body.dailyReviewTime !== undefined) updateData.dailyReviewTime = body.dailyReviewTime;
  if (body.encryptionEnabled !== undefined) updateData.encryptionEnabled = body.encryptionEnabled;

  await db.update(userSettings).set(updateData).where(eq(userSettings.userId, userId));

  const result = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });

  return c.json({ data: result });
});

export { settingsRoutes };
