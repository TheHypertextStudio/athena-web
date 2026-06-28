/**
 * Onboarding OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const OnboardingStepSchema = z
  .enum(['intent', 'integrations', 'agenda'])
  .openapi({
    description: 'Onboarding step',
    example: 'intent',
  });

export const LegacyOnboardingStepSchema = z
  .enum(['welcome', 'profile', 'integrations', 'preferences', 'tour', 'complete'])
  .openapi({
    description: 'Legacy onboarding step',
    example: 'welcome',
  });

// =============================================================================
// Core Onboarding Schemas
// =============================================================================

export const IntentChipSchema = z
  .object({
    id: z.string().openapi({ description: 'Chip identifier' }),
    label: z.string().openapi({ description: 'Chip label' }),
    icon: z.string().openapi({ description: 'Chip icon' }),
  })
  .openapi('IntentChip');

export const OnboardingIntentSchema = z
  .object({
    selectedChips: z.array(z.string()).openapi({ description: 'Selected chip IDs' }),
    customText: z.string().nullable().openapi({ description: 'Custom intent text' }),
    confirmedAt: TimestampSchema.nullable().openapi({ description: 'Confirmation timestamp' }),
  })
  .openapi('OnboardingIntent');

export const OnboardingIntegrationSchema = z
  .object({
    provider: z.string().openapi({ description: 'Provider identifier' }),
    connectedAt: TimestampSchema.openapi({ description: 'Connection timestamp' }),
    syncedEventsCount: z.number().int().optional().openapi({ description: 'Synced events count' }),
  })
  .openapi('OnboardingIntegration');

export const OnboardingMetadataSchema = z
  .object({
    intent: OnboardingIntentSchema.optional().openapi({ description: 'Intent metadata' }),
    conversationId: z.string().nullable().optional().openapi({ description: 'AI conversation ID' }),
    integrations: z
      .array(OnboardingIntegrationSchema)
      .optional()
      .openapi({ description: 'Connected integrations' }),
    agendaGenerated: z.boolean().optional().openapi({ description: 'Agenda generated flag' }),
    agendaApprovedAt: TimestampSchema.nullable()
      .optional()
      .openapi({ description: 'Agenda approval timestamp' }),
  })
  .openapi('OnboardingMetadata');

// =============================================================================
// Request Bodies
// =============================================================================

export const UpdateOnboardingRequestSchema = z
  .object({
    step: OnboardingStepSchema.optional().openapi({ description: 'Advance to this step' }),
    metadata: OnboardingMetadataSchema.optional().openapi({
      description: 'Metadata to merge (intent, integrations, etc.)',
    }),
    complete: z.boolean().optional().openapi({ description: 'Mark onboarding as complete' }),
    skip: z.boolean().optional().openapi({ description: 'Mark onboarding as skipped' }),
  })
  .openapi('UpdateOnboardingRequest');

export const UpdateOnboardingStepRequestSchema = z
  .object({
    step: z.string().min(1).openapi({ description: 'Legacy onboarding step' }),
    metadata: z.record(z.string(), z.unknown()).optional().openapi({
      description: 'Legacy onboarding metadata payload',
    }),
  })
  .openapi('UpdateOnboardingStepRequest');

export const OnboardingCompleteRequestSchema = z
  .object({})
  .openapi('OnboardingCompleteRequest');

export const OnboardingSkipRequestSchema = z
  .object({})
  .openapi('OnboardingSkipRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const OnboardingStatusResponseSchema = z
  .object({
    currentStep: OnboardingStepSchema,
    metadata: OnboardingMetadataSchema,
    skippedAt: TimestampSchema.nullable().openapi({ description: 'Skip timestamp' }),
    completedAt: TimestampSchema.nullable().openapi({ description: 'Completion timestamp' }),
    user: z
      .object({
        name: z.string().nullable().openapi({ description: 'User display name' }),
        email: z.string().nullable().openapi({ description: 'User email' }),
      })
      .nullable()
      .openapi({ description: 'User info' }),
  })
  .openapi('OnboardingStatusResponse');

export const OnboardingUpdateResponseSchema = z
  .object({
    currentStep: OnboardingStepSchema,
    metadata: OnboardingMetadataSchema,
    completedAt: TimestampSchema.nullable().openapi({ description: 'Completion timestamp' }),
    skippedAt: TimestampSchema.nullable().openapi({ description: 'Skip timestamp' }),
    redirectTo: z.string().nullable().openapi({ description: 'Redirect target' }),
  })
  .openapi('OnboardingUpdateResponse');

export const LegacyOnboardingProgressSchema = z
  .object({
    current: z.number().int().openapi({ description: 'Current step index (1-based)' }),
    total: z.number().int().openapi({ description: 'Total steps' }),
    percentage: z.number().int().openapi({ description: 'Progress percentage' }),
  })
  .openapi('LegacyOnboardingProgress');

export const LegacyOnboardingStatusSchema = z
  .object({
    currentStep: LegacyOnboardingStepSchema,
    completedSteps: z.array(LegacyOnboardingStepSchema),
    isCompleted: z.boolean().openapi({ description: 'Completion state' }),
    isSkipped: z.boolean().openapi({ description: 'Skip state' }),
    progress: LegacyOnboardingProgressSchema,
  })
  .openapi('LegacyOnboardingStatus');

export const LegacyOnboardingStatusResponseSchema = successResponseSchema(
  LegacyOnboardingStatusSchema,
  'Legacy onboarding status response',
).openapi('LegacyOnboardingStatusResponse');

export const OnboardingCompleteResponseSchema = successResponseSchema(
  z.object({
    completed: z.boolean().openapi({ description: 'Completion flag' }),
    completedAt: TimestampSchema.openapi({ description: 'Completion timestamp' }),
  }),
  'Onboarding complete response',
).openapi('OnboardingCompleteResponse');

export const OnboardingSkipResponseSchema = successResponseSchema(
  z.object({
    skipped: z.boolean().openapi({ description: 'Skip flag' }),
    skippedAt: TimestampSchema.openapi({ description: 'Skip timestamp' }),
  }),
  'Onboarding skip response',
).openapi('OnboardingSkipResponse');

export const IntentChipsResponseSchema = z
  .object({
    chips: z.array(IntentChipSchema),
  })
  .openapi('IntentChipsResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;
export type LegacyOnboardingStep = z.infer<typeof LegacyOnboardingStepSchema>;
export type OnboardingIntent = z.infer<typeof OnboardingIntentSchema>;
export type OnboardingIntegration = z.infer<typeof OnboardingIntegrationSchema>;
export type OnboardingMetadata = z.infer<typeof OnboardingMetadataSchema>;
export type UpdateOnboardingRequest = z.infer<typeof UpdateOnboardingRequestSchema>;
export type UpdateOnboardingStepRequest = z.infer<typeof UpdateOnboardingStepRequestSchema>;
export type OnboardingCompleteRequest = z.infer<typeof OnboardingCompleteRequestSchema>;
export type OnboardingSkipRequest = z.infer<typeof OnboardingSkipRequestSchema>;
export type OnboardingStatusResponse = z.infer<typeof OnboardingStatusResponseSchema>;
export type OnboardingUpdateResponse = z.infer<typeof OnboardingUpdateResponseSchema>;
export type LegacyOnboardingStatus = z.infer<typeof LegacyOnboardingStatusSchema>;
export type LegacyOnboardingStatusResponse = z.infer<typeof LegacyOnboardingStatusResponseSchema>;
export type OnboardingCompleteResponse = z.infer<typeof OnboardingCompleteResponseSchema>;
export type OnboardingSkipResponse = z.infer<typeof OnboardingSkipResponseSchema>;
export type IntentChipsResponse = z.infer<typeof IntentChipsResponseSchema>;
