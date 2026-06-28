/**
 * Onboarding route serializers.
 *
 * @packageDocumentation
 */

import type {
  onboardingProgress,
  OnboardingMetadata as DbOnboardingMetadata,
} from '../../db/schema/index.js';
import type { OnboardingMetadata as ApiOnboardingMetadata } from '@athena/types/openapi/onboarding';
import { DEFAULT_STEP } from './helpers.js';

type OnboardingProgressRow = typeof onboardingProgress.$inferSelect;

type UserSummary = {
  name: string | null;
  email: string | null;
} | null;

const parseRequiredDate = (value: string | Date): Date =>
  value instanceof Date ? value : new Date(value);

const parseOptionalDate = (value: string | Date | null | undefined): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
};

const normalizeMetadata = (
  metadata: DbOnboardingMetadata | null | undefined,
): ApiOnboardingMetadata => {
  if (!metadata) {
    return {};
  }

  const normalized: ApiOnboardingMetadata = {};

  if (metadata.intent) {
    normalized.intent = {
      ...metadata.intent,
      confirmedAt: parseOptionalDate(metadata.intent.confirmedAt),
    };
  }

  if (metadata.integrations) {
    normalized.integrations = metadata.integrations.map((integration) => ({
      ...integration,
      connectedAt: parseRequiredDate(integration.connectedAt),
    }));
  }

  if (metadata.conversationId !== undefined) {
    normalized.conversationId = metadata.conversationId;
  }

  if (metadata.agendaGenerated !== undefined) {
    normalized.agendaGenerated = metadata.agendaGenerated;
  }

  if (metadata.agendaApprovedAt !== undefined) {
    normalized.agendaApprovedAt = parseOptionalDate(metadata.agendaApprovedAt);
  }

  return normalized;
};

export function toOnboardingStatus(progress: OnboardingProgressRow, user: UserSummary) {
  return {
    currentStep: progress.currentStep,
    metadata: normalizeMetadata(progress.metadata),
    skippedAt: progress.skippedAt ?? null,
    completedAt: progress.completedAt ?? null,
    user,
  };
}

export function toOnboardingUpdate(
  progress: OnboardingProgressRow | null | undefined,
  redirectTo: string | null,
) {
  return {
    currentStep: progress?.currentStep ?? DEFAULT_STEP,
    metadata: normalizeMetadata(progress?.metadata),
    completedAt: progress?.completedAt ?? null,
    skippedAt: progress?.skippedAt ?? null,
    redirectTo,
  };
}
