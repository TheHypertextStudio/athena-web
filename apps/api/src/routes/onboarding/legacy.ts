/**
 * Legacy onboarding helpers.
 *
 * @packageDocumentation
 */

import type { onboardingProgress, OnboardingMetadata as DbOnboardingMetadata } from '../../db/schema/index.js';
import {
  LEGACY_DEFAULT_STEP,
  LEGACY_ONBOARDING_STEPS,
  isLegacyOnboardingStep,
  type LegacyOnboardingStep,
} from './helpers.js';

type OnboardingProgressRow = typeof onboardingProgress.$inferSelect;

interface LegacyProgressSummary {
  current: number;
  total: number;
  percentage: number;
}

interface LegacyStatusData {
  currentStep: LegacyOnboardingStep;
  completedSteps: LegacyOnboardingStep[];
  isCompleted: boolean;
  isSkipped: boolean;
  progress: LegacyProgressSummary;
}

type MetadataRecord = Record<string, unknown>;

const toMetadataRecord = (metadata: DbOnboardingMetadata | null | undefined): MetadataRecord =>
  (metadata ?? {}) as MetadataRecord;

const toLegacyStepList = (value: unknown): LegacyOnboardingStep[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (step): step is LegacyOnboardingStep =>
      typeof step === 'string' && isLegacyOnboardingStep(step),
  );
};

export const resolveLegacyCurrentStep = (progress: OnboardingProgressRow): LegacyOnboardingStep => {
  const metadata = toMetadataRecord(progress.metadata);
  const metadataStep = metadata.legacyCurrentStep;

  if (typeof metadataStep === 'string' && isLegacyOnboardingStep(metadataStep)) {
    return metadataStep;
  }

  const currentStep = progress.currentStep;
  if (typeof currentStep === 'string' && isLegacyOnboardingStep(currentStep)) {
    return currentStep;
  }

  return LEGACY_DEFAULT_STEP;
};

export const resolveLegacyCompletedSteps = (
  progress: OnboardingProgressRow,
): LegacyOnboardingStep[] => {
  const rawCompletedSteps = (progress as { completedSteps?: unknown }).completedSteps;
  const completedSteps = toLegacyStepList(rawCompletedSteps);
  if (completedSteps.length > 0) {
    return completedSteps;
  }

  const metadata = toMetadataRecord(progress.metadata);
  return toLegacyStepList(metadata.completedSteps);
};

export const buildLegacyProgressSummary = (
  currentStep: LegacyOnboardingStep,
): LegacyProgressSummary => {
  const total = LEGACY_ONBOARDING_STEPS.length;
  const stepIndex = LEGACY_ONBOARDING_STEPS.indexOf(currentStep);
  const current = stepIndex >= 0 ? stepIndex + 1 : 1;
  const percentage = Math.round((current / total) * 100);

  return {
    current,
    total,
    percentage,
  };
};

export const toLegacyOnboardingStatusData = (
  progress: OnboardingProgressRow,
): LegacyStatusData => {
  const currentStep = resolveLegacyCurrentStep(progress);
  const completedSteps = resolveLegacyCompletedSteps(progress);

  return {
    currentStep,
    completedSteps,
    isCompleted: Boolean(progress.completedAt),
    isSkipped: Boolean(progress.skippedAt),
    progress: buildLegacyProgressSummary(currentStep),
  };
};

export const mergeLegacyMetadata = (
  existing: DbOnboardingMetadata | null | undefined,
  incoming: MetadataRecord | undefined,
  legacyCurrentStep: LegacyOnboardingStep,
  completedSteps: LegacyOnboardingStep[],
): DbOnboardingMetadata => {
  const merged: MetadataRecord = {
    ...(existing ?? {}),
    ...(incoming ?? {}),
    legacyCurrentStep,
    completedSteps,
  };

  return merged as DbOnboardingMetadata;
};
