/**
 * Onboarding routes for tracking user onboarding progress.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { onboardingProgress } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const onboardingRoutes = new Hono();

onboardingRoutes.use('*', requireAuth);

/**
 * Onboarding steps in order.
 */
const ONBOARDING_STEPS = [
  'welcome',
  'profile',
  'integrations',
  'preferences',
  'tour',
  'complete',
] as const;

type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
const DEFAULT_ONBOARDING_STEP: OnboardingStep = 'welcome';
const COMPLETED_ONBOARDING_STEP: OnboardingStep = 'complete';
const ERROR_ONBOARDING_PROGRESS_UNAVAILABLE = 'Onboarding progress unavailable';
const ERROR_INVALID_ONBOARDING_STEP = 'Invalid onboarding step';
const ERROR_INVALID_ONBOARDING_STATE = 'Invalid onboarding progress state';
const ERROR_ONBOARDING_NOT_STARTED = 'Onboarding not started';
const ERROR_ONBOARDING_ALREADY_FINISHED = 'Onboarding already finished';
const ERROR_INVALID_ONBOARDING_METADATA = 'Invalid onboarding metadata';
const ERROR_INVALID_ONBOARDING_METADATA_STATE = 'Invalid onboarding metadata state';
const ERROR_ONBOARDING_ALREADY_COMPLETED = 'Onboarding already completed';
const ERROR_ONBOARDING_ALREADY_SKIPPED = 'Onboarding already skipped';

/**
 * Get onboarding status for the authenticated user.
 * GET /api/onboarding
 */
onboardingRoutes.get('/', async (c) => {
  const userId = getUserId(c);

  let progress = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  // If no progress exists, create initial record
  if (!progress) {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(onboardingProgress).values({
      id,
      userId,
      currentStep: DEFAULT_ONBOARDING_STEP,
      completedSteps: [],
      createdAt: now,
      updatedAt: now,
    });

    progress = await db.query.onboardingProgress.findFirst({
      where: eq(onboardingProgress.userId, userId),
    });
  }

  if (!progress) {
    return c.json({ error: ERROR_ONBOARDING_PROGRESS_UNAVAILABLE }, 500);
  }

  if (!ONBOARDING_STEPS.includes(progress.currentStep as OnboardingStep)) {
    return c.json({ error: ERROR_INVALID_ONBOARDING_STEP }, 500);
  }

  if (!Array.isArray(progress.completedSteps)) {
    return c.json({ error: ERROR_INVALID_ONBOARDING_STATE }, 500);
  }

  const isCompleted = progress.completedAt !== null;
  const isSkipped = progress.skippedAt !== null;
  const currentStepIndex = ONBOARDING_STEPS.indexOf(progress.currentStep as OnboardingStep);
  const totalSteps = ONBOARDING_STEPS.length;

  return c.json({
    data: {
      currentStep: progress.currentStep,
      completedSteps: progress.completedSteps,
      isCompleted,
      isSkipped,
      progress: {
        current: currentStepIndex + 1,
        total: totalSteps,
        percentage: Math.round(((currentStepIndex + 1) / totalSteps) * 100),
      },
      metadata: progress.metadata,
    },
  });
});

/**
 * Update current onboarding step.
 * PATCH /api/onboarding/step
 */
onboardingRoutes.patch('/step', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    step: string;
    metadata?: Record<string, unknown> | null;
  }>();

  if (!ONBOARDING_STEPS.includes(body.step as OnboardingStep)) {
    return c.json({ error: ERROR_INVALID_ONBOARDING_STEP }, 400);
  }

  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  if (!existing) {
    return c.json({ error: ERROR_ONBOARDING_NOT_STARTED }, 404);
  }

  if (existing.completedAt || existing.skippedAt) {
    return c.json({ error: ERROR_ONBOARDING_ALREADY_FINISHED }, 400);
  }

  // Add current step to completed steps if not already there
  if (!Array.isArray(existing.completedSteps)) {
    return c.json({ error: ERROR_INVALID_ONBOARDING_STATE }, 500);
  }
  const completedSteps = [...existing.completedSteps];
  if (existing.currentStep && !completedSteps.includes(existing.currentStep)) {
    completedSteps.push(existing.currentStep);
  }

  const updateData: Record<string, unknown> = {
    currentStep: body.step,
    completedSteps,
    updatedAt: new Date(),
  };

  if (body.metadata !== undefined) {
    if (
      body.metadata === null ||
      typeof body.metadata !== 'object' ||
      Array.isArray(body.metadata)
    ) {
      return c.json({ error: ERROR_INVALID_ONBOARDING_METADATA }, 400);
    }
    const existingMetadata = existing.metadata;
    const normalizedMetadata =
      existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata)
        ? (existingMetadata as Record<string, unknown>)
        : null;
    if (existingMetadata !== null && existingMetadata !== undefined && !normalizedMetadata) {
      return c.json({ error: ERROR_INVALID_ONBOARDING_METADATA_STATE }, 500);
    }
    updateData.metadata = {
      ...(normalizedMetadata ?? {}),
      ...body.metadata,
    };
  }

  await db.update(onboardingProgress).set(updateData).where(eq(onboardingProgress.userId, userId));

  const updated = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  return c.json({
    data: {
      currentStep: updated?.currentStep,
      completedSteps: updated?.completedSteps,
    },
  });
});

/**
 * Complete onboarding.
 * POST /api/onboarding/complete
 */
onboardingRoutes.post('/complete', async (c) => {
  const userId = getUserId(c);

  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  if (!existing) {
    return c.json({ error: ERROR_ONBOARDING_NOT_STARTED }, 404);
  }

  if (existing.completedAt) {
    return c.json({ error: ERROR_ONBOARDING_ALREADY_COMPLETED }, 400);
  }

  const now = new Date();
  if (!Array.isArray(existing.completedSteps)) {
    return c.json({ error: ERROR_INVALID_ONBOARDING_STATE }, 500);
  }
  const completedSteps = [...existing.completedSteps];
  if (existing.currentStep && !completedSteps.includes(existing.currentStep)) {
    completedSteps.push(existing.currentStep);
  }

  await db
    .update(onboardingProgress)
    .set({
      currentStep: COMPLETED_ONBOARDING_STEP,
      completedSteps,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(onboardingProgress.userId, userId));

  return c.json({
    data: {
      completed: true,
      completedAt: now.toISOString(),
    },
  });
});

/**
 * Skip onboarding.
 * POST /api/onboarding/skip
 */
onboardingRoutes.post('/skip', async (c) => {
  const userId = getUserId(c);

  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  if (!existing) {
    // Create and immediately skip
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(onboardingProgress).values({
      id,
      userId,
      currentStep: DEFAULT_ONBOARDING_STEP,
      completedSteps: [],
      skippedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return c.json({
      data: {
        skipped: true,
        skippedAt: now.toISOString(),
      },
    });
  }

  if (existing.completedAt) {
    return c.json({ error: ERROR_ONBOARDING_ALREADY_COMPLETED }, 400);
  }

  if (existing.skippedAt) {
    return c.json({ error: ERROR_ONBOARDING_ALREADY_SKIPPED }, 400);
  }

  const now = new Date();

  await db
    .update(onboardingProgress)
    .set({
      skippedAt: now,
      updatedAt: now,
    })
    .where(eq(onboardingProgress.userId, userId));

  return c.json({
    data: {
      skipped: true,
      skippedAt: now.toISOString(),
    },
  });
});

/**
 * Reset onboarding (for testing/support purposes).
 * DELETE /api/onboarding
 */
onboardingRoutes.delete('/', async (c) => {
  const userId = getUserId(c);

  await db.delete(onboardingProgress).where(eq(onboardingProgress.userId, userId));

  return c.body(null, 204);
});

export { onboardingRoutes };
