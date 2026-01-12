/**
 * Onboarding OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { successResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const OnboardingStepSchema = z
  .enum(['welcome', 'profile', 'integrations', 'preferences', 'tour', 'complete'])
  .openapi({
    description: 'Onboarding step',
    example: 'welcome',
  });

// =============================================================================
// Core Onboarding Schemas
// =============================================================================

export const OnboardingProgressSchema = z
  .object({
    currentStep: OnboardingStepSchema.openapi({ description: 'Current step' }),
    completedSteps: z.array(z.string()).openapi({ description: 'Completed steps' }),
    isCompleted: z.boolean().openapi({ description: 'Whether onboarding is complete' }),
    isSkipped: z.boolean().openapi({ description: 'Whether onboarding was skipped' }),
    progress: z
      .object({
        current: z.number().int().openapi({ description: 'Current step number' }),
        total: z.number().int().openapi({ description: 'Total steps' }),
        percentage: z.number().int().openapi({ description: 'Progress percentage' }),
      })
      .openapi({ description: 'Progress info' }),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({ description: 'Step metadata' }),
  })
  .openapi('OnboardingProgress');

export const OnboardingUpdateResultSchema = z
  .object({
    currentStep: z.string().openapi({ description: 'Current step' }),
    completedSteps: z.array(z.string()).openapi({ description: 'Completed steps' }),
  })
  .openapi('OnboardingUpdateResult');

export const OnboardingCompleteResultSchema = z
  .object({
    completed: z.boolean().openapi({ description: 'Completion status' }),
    completedAt: z.string().openapi({ description: 'Completion timestamp' }),
  })
  .openapi('OnboardingCompleteResult');

export const OnboardingSkipResultSchema = z
  .object({
    skipped: z.boolean().openapi({ description: 'Skip status' }),
    skippedAt: z.string().openapi({ description: 'Skip timestamp' }),
  })
  .openapi('OnboardingSkipResult');

// =============================================================================
// Request Bodies
// =============================================================================

export const UpdateOnboardingStepRequestSchema = z
  .object({
    step: OnboardingStepSchema.openapi({ description: 'Step to set as current' }),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ description: 'Step metadata' }),
  })
  .openapi('UpdateOnboardingStepRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const OnboardingProgressResponseSchema = successResponseSchema(
  OnboardingProgressSchema,
  'Onboarding progress',
).openapi('OnboardingProgressResponse');

export const OnboardingUpdateResponseSchema = successResponseSchema(
  OnboardingUpdateResultSchema,
  'Onboarding update result',
).openapi('OnboardingUpdateResponse');

export const OnboardingCompleteResponseSchema = successResponseSchema(
  OnboardingCompleteResultSchema,
  'Onboarding complete result',
).openapi('OnboardingCompleteResponse');

export const OnboardingSkipResponseSchema = successResponseSchema(
  OnboardingSkipResultSchema,
  'Onboarding skip result',
).openapi('OnboardingSkipResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;
export type OnboardingProgress = z.infer<typeof OnboardingProgressSchema>;
export type UpdateOnboardingStepRequest = z.infer<typeof UpdateOnboardingStepRequestSchema>;
