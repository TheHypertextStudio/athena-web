/**
 * Onboarding routes for the 3-step conversational onboarding flow.
 *
 * This is a minimal RESTful API that manages onboarding state.
 * Other functionality is delegated to general-purpose endpoints:
 * - AI conversation: POST /api/ai/chat with context: "onboarding"
 * - Calendar connections: /api/calendar-sync/*
 * - Time block generation: POST /api/time-blocks/generate
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import {
  ErrorResponseSchema,
  UnauthorizedErrorSchema,
} from '@athena/types/openapi/common';
import {
  IntentChipsResponseSchema,
  LegacyOnboardingStatusResponseSchema,
  OnboardingCompleteRequestSchema,
  OnboardingCompleteResponseSchema,
  OnboardingSkipRequestSchema,
  OnboardingSkipResponseSchema,
  OnboardingStatusResponseSchema,
  OnboardingUpdateResponseSchema,
  UpdateOnboardingRequestSchema,
  UpdateOnboardingStepRequestSchema,
} from '@athena/types/openapi/onboarding';
import { db } from '../db/index.js';
import { onboardingProgress, type OnboardingMetadata as DbOnboardingMetadata } from '../db/schema/index.js';
import { users } from '../db/schema/auth.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { DEFAULT_STEP, INTENT_CHIPS, mergeOnboardingMetadata } from './onboarding/helpers.js';
import { toLegacyOnboardingStatusData } from './onboarding/legacy.js';
import { toOnboardingStatus, toOnboardingUpdate } from './onboarding/serializers.js';
import {
  ERROR_ONBOARDING_ALREADY_FINISHED,
  completeLegacyOnboarding,
  getOrCreateOnboardingProgress,
  skipLegacyOnboarding,
  updateLegacyOnboardingStep,
} from './onboarding/service.js';

const onboardingRoutes = createOpenAPIApp();

onboardingRoutes.use('*', requireAuth);

// =============================================================================
// Get Onboarding Status
// =============================================================================

const getOnboardingStatus = createRoute({
  method: 'get',
  path: '/',
  tags: ['Onboarding'],
  summary: 'Get onboarding status',
  description: 'Get current onboarding state for the authenticated user.',
  responses: {
    200: {
      description: 'Onboarding status retrieved successfully',
      content: {
        'application/json': {
          schema: OnboardingStatusResponseSchema,
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
    500: {
      description: 'Internal error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Onboarding
// =============================================================================

const patchOnboarding = createRoute({
  method: 'patch',
  path: '/',
  tags: ['Onboarding'],
  summary: 'Update onboarding',
  description:
    'Update onboarding state. Can advance step, merge metadata, complete, or skip.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdateOnboardingRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Onboarding updated successfully',
      content: {
        'application/json': {
          schema: OnboardingUpdateResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request or onboarding already finished',
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
    500: {
      description: 'Internal error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Legacy Step Update
// =============================================================================

const updateOnboardingStep = createRoute({
  method: 'patch',
  path: '/step',
  tags: ['Onboarding'],
  summary: 'Update onboarding step',
  description: 'Advance onboarding to a new step (legacy endpoint).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdateOnboardingStepRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Onboarding step updated',
      content: {
        'application/json': {
          schema: LegacyOnboardingStatusResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid step or onboarding already finished',
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
      description: 'Onboarding not started',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Legacy Complete
// =============================================================================

const completeOnboarding = createRoute({
  method: 'post',
  path: '/complete',
  tags: ['Onboarding'],
  summary: 'Complete onboarding',
  description: 'Mark onboarding as complete (legacy endpoint).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: OnboardingCompleteRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Onboarding completed',
      content: {
        'application/json': {
          schema: OnboardingCompleteResponseSchema,
        },
      },
    },
    400: {
      description: 'Onboarding already completed',
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
      description: 'Onboarding not started',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Legacy Skip
// =============================================================================

const skipOnboarding = createRoute({
  method: 'post',
  path: '/skip',
  tags: ['Onboarding'],
  summary: 'Skip onboarding',
  description: 'Skip onboarding (legacy endpoint).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: OnboardingSkipRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Onboarding skipped',
      content: {
        'application/json': {
          schema: OnboardingSkipResponseSchema,
        },
      },
    },
    400: {
      description: 'Onboarding already completed or skipped',
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
  },
});

// =============================================================================
// Reset Onboarding
// =============================================================================

const resetOnboarding = createRoute({
  method: 'delete',
  path: '/',
  tags: ['Onboarding'],
  summary: 'Reset onboarding',
  description: 'Reset onboarding progress (for testing/support).',
  responses: {
    204: {
      description: 'Onboarding reset successfully',
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
// Intent Chips
// =============================================================================

const getIntentChips = createRoute({
  method: 'get',
  path: '/intent-chips',
  tags: ['Onboarding'],
  summary: 'Get intent chips',
  description: 'Get curated intent chip options for the first step.',
  responses: {
    200: {
      description: 'Intent chips retrieved',
      content: {
        'application/json': {
          schema: IntentChipsResponseSchema,
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
 * Get onboarding status.
 *
 * GET /api/onboarding
 *
 * Returns current onboarding state including step, metadata, and user info.
 */
onboardingRoutes.openapi(getOnboardingStatus, async (c) => {
  const userId = getUserId(c);

  // Get user info for the response
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      name: true,
      email: true,
    },
  });

  const progress = await getOrCreateOnboardingProgress(userId);

  if (!progress) {
    return c.json({ error: 'Failed to create onboarding progress' }, 500);
  }

  const status = toOnboardingStatus(
    progress,
    user
      ? {
          name: user.name,
          email: user.email,
        }
      : null,
  );
  const legacyData = toLegacyOnboardingStatusData(progress);

  return c.json({ ...status, data: legacyData }, 200);
});

/**
 * Update onboarding state.
 *
 * PATCH /api/onboarding
 *
 * Unified endpoint to:
 * - Advance to a new step
 * - Merge metadata
 * - Mark as complete
 * - Mark as skipped
 */
onboardingRoutes.openapi(patchOnboarding, async (c) => {
  const userId = getUserId(c);
  const { step, metadata, complete, skip } = c.req.valid('json');

  // Get or create progress
  let existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  const now = new Date();

  if (!existing) {
    // Create initial record
    const id = crypto.randomUUID();
    await db.insert(onboardingProgress).values({
      id,
      userId,
      currentStep: DEFAULT_STEP,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    existing = await db.query.onboardingProgress.findFirst({
      where: eq(onboardingProgress.userId, userId),
    });
  }

  if (!existing) {
    return c.json({ error: 'Failed to create onboarding progress' }, 500);
  }

  // Check if already finished
  if ((existing.completedAt || existing.skippedAt) && !complete && !skip) {
    return c.json({ error: ERROR_ONBOARDING_ALREADY_FINISHED }, 400);
  }

  // Build update object
  const metadataInput = complete ? { ...(metadata ?? {}), agendaApprovedAt: now } : metadata;
  const mergedMetadata: DbOnboardingMetadata = mergeOnboardingMetadata(
    existing.metadata,
    metadataInput,
  );

  // Determine redirect URL
  let redirectTo: string | null = null;

  const updateData: Partial<typeof onboardingProgress.$inferInsert> = {
    metadata: mergedMetadata,
    updatedAt: now,
  };

  if (step) {
    updateData.currentStep = step;
  }

  if (complete) {
    updateData.completedAt = now;
    redirectTo = '/home';
  }

  if (skip) {
    updateData.skippedAt = now;
    redirectTo = '/home';
  }

  await db
    .update(onboardingProgress)
    .set(updateData)
    .where(eq(onboardingProgress.userId, userId));

  const updated = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  const response = toOnboardingUpdate(updated, redirectTo);
  const legacyData = updated ? toLegacyOnboardingStatusData(updated) : undefined;

  return c.json(legacyData ? { ...response, data: legacyData } : response, 200);
});

/**
 * Update onboarding step (legacy).
 *
 * PATCH /api/onboarding/step
 */
onboardingRoutes.openapi(updateOnboardingStep, async (c) => {
  const userId = getUserId(c);
  const { step, metadata } = c.req.valid('json');

  const result = await updateLegacyOnboardingStep(userId, step, metadata);

  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }

  return c.json({ data: toLegacyOnboardingStatusData(result.progress) }, 200);
});

/**
 * Complete onboarding (legacy).
 *
 * POST /api/onboarding/complete
 */
onboardingRoutes.openapi(completeOnboarding, async (c) => {
  const userId = getUserId(c);
  const result = await completeLegacyOnboarding(userId);

  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }

  return c.json(
    {
      data: {
        completed: true,
        completedAt: result.completedAt.toISOString(),
      },
    },
    200,
  );
});

/**
 * Skip onboarding (legacy).
 *
 * POST /api/onboarding/skip
 */
onboardingRoutes.openapi(skipOnboarding, async (c) => {
  const userId = getUserId(c);
  const result = await skipLegacyOnboarding(userId);

  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }

  return c.json(
    {
      data: {
        skipped: true,
        skippedAt: result.skippedAt.toISOString(),
      },
    },
    200,
  );
});

/**
 * Reset onboarding (for testing/support).
 *
 * DELETE /api/onboarding
 */
onboardingRoutes.openapi(resetOnboarding, async (c) => {
  const userId = getUserId(c);

  await db.delete(onboardingProgress).where(eq(onboardingProgress.userId, userId));

  return c.body(null, 204);
});

/**
 * Get available intent chips.
 *
 * GET /api/onboarding/intent-chips
 */
onboardingRoutes.openapi(getIntentChips, (c) => {
  return c.json({ chips: INTENT_CHIPS.map((chip) => ({ ...chip })) }, 200);
});

export { onboardingRoutes };
