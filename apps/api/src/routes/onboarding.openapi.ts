/**
 * Onboarding OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  UpdateOnboardingStepRequestSchema,
  OnboardingProgressResponseSchema,
  OnboardingUpdateResponseSchema,
  OnboardingCompleteResponseSchema,
  OnboardingSkipResponseSchema,
} from '@athena/types/openapi/onboarding';
import {
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ErrorResponseSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// Get Onboarding Progress
// =============================================================================

export const getOnboardingProgress = createRoute({
  method: 'get',
  path: '/',
  tags: ['Onboarding'],
  summary: 'Get onboarding progress',
  description: 'Get onboarding status for the authenticated user.',
  responses: {
    200: {
      description: 'Onboarding progress retrieved successfully',
      content: {
        'application/json': {
          schema: OnboardingProgressResponseSchema,
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
// Update Onboarding Step
// =============================================================================

export const updateOnboardingStep = createRoute({
  method: 'patch',
  path: '/step',
  tags: ['Onboarding'],
  summary: 'Update onboarding step',
  description: 'Update current onboarding step.',
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
      description: 'Step updated successfully',
      content: {
        'application/json': {
          schema: OnboardingUpdateResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid step or onboarding finished',
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
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Complete Onboarding
// =============================================================================

export const completeOnboarding = createRoute({
  method: 'post',
  path: '/complete',
  tags: ['Onboarding'],
  summary: 'Complete onboarding',
  description: 'Mark onboarding as complete.',
  responses: {
    200: {
      description: 'Onboarding completed successfully',
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
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Skip Onboarding
// =============================================================================

export const skipOnboarding = createRoute({
  method: 'post',
  path: '/skip',
  tags: ['Onboarding'],
  summary: 'Skip onboarding',
  description: 'Skip the onboarding process.',
  responses: {
    200: {
      description: 'Onboarding skipped successfully',
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

export const resetOnboarding = createRoute({
  method: 'delete',
  path: '/',
  tags: ['Onboarding'],
  summary: 'Reset onboarding',
  description: 'Reset onboarding progress.',
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
