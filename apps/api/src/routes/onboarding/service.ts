/**
 * Onboarding data access and legacy workflow helpers.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { onboardingProgress } from '../../db/schema/index.js';
import {
  DEFAULT_STEP,
  LEGACY_DEFAULT_STEP,
  isLegacyOnboardingStep,
  mapLegacyStepToCurrentStep,
  type LegacyOnboardingStep,
} from './helpers.js';
import {
  mergeLegacyMetadata,
  resolveLegacyCompletedSteps,
  resolveLegacyCurrentStep,
} from './legacy.js';

type OnboardingProgressRow = typeof onboardingProgress.$inferSelect;

type LegacyUpdateResult =
  | { ok: true; progress: OnboardingProgressRow }
  | { ok: false; status: 400 | 404; error: string };

type LegacyCompleteResult =
  | { ok: true; completedAt: Date }
  | { ok: false; status: 400 | 404; error: string };

type LegacySkipResult =
  | { ok: true; skippedAt: Date }
  | { ok: false; status: 400; error: string };

export const ERROR_ONBOARDING_NOT_STARTED = 'Onboarding not started';
export const ERROR_INVALID_ONBOARDING_STEP = 'Invalid onboarding step';
export const ERROR_ONBOARDING_ALREADY_FINISHED = 'Onboarding already finished';
export const ERROR_ONBOARDING_ALREADY_COMPLETED = 'Onboarding already completed';
export const ERROR_ONBOARDING_ALREADY_SKIPPED = 'Onboarding already skipped';

export const getOrCreateOnboardingProgress = async (
  userId: string,
): Promise<OnboardingProgressRow | null> => {
  let progress = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  if (progress) {
    return progress;
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const metadata = mergeLegacyMetadata(undefined, undefined, LEGACY_DEFAULT_STEP, []);

  await db.insert(onboardingProgress).values({
    id,
    userId,
    currentStep: DEFAULT_STEP,
    metadata,
    createdAt: now,
    updatedAt: now,
  });

  progress = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  return progress ?? null;
};

export const updateLegacyOnboardingStep = async (
  userId: string,
  step: string,
  metadata: Record<string, unknown> | undefined,
): Promise<LegacyUpdateResult> => {
  if (!isLegacyOnboardingStep(step)) {
    return { ok: false, status: 400, error: ERROR_INVALID_ONBOARDING_STEP };
  }

  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  if (!existing) {
    return { ok: false, status: 404, error: ERROR_ONBOARDING_NOT_STARTED };
  }

  if (existing.completedAt || existing.skippedAt) {
    return { ok: false, status: 400, error: ERROR_ONBOARDING_ALREADY_FINISHED };
  }

  const currentLegacyStep = resolveLegacyCurrentStep(existing);
  const completedSteps = resolveLegacyCompletedSteps(existing);
  const nextCompletedSteps = completedSteps.includes(currentLegacyStep)
    ? completedSteps
    : [...completedSteps, currentLegacyStep];

  const mergedMetadata = mergeLegacyMetadata(
    existing.metadata,
    metadata,
    step,
    nextCompletedSteps,
  );

  const now = new Date();

  await db
    .update(onboardingProgress)
    .set({
      currentStep: mapLegacyStepToCurrentStep(step),
      metadata: mergedMetadata,
      updatedAt: now,
    })
    .where(eq(onboardingProgress.userId, userId));

  const updated = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  return {
    ok: true,
    progress: updated ?? {
      ...existing,
      currentStep: mapLegacyStepToCurrentStep(step),
      metadata: mergedMetadata,
      updatedAt: now,
    },
  };
};

export const completeLegacyOnboarding = async (userId: string): Promise<LegacyCompleteResult> => {
  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  if (!existing) {
    return { ok: false, status: 404, error: ERROR_ONBOARDING_NOT_STARTED };
  }

  if (existing.completedAt) {
    return { ok: false, status: 400, error: ERROR_ONBOARDING_ALREADY_COMPLETED };
  }

  const now = new Date();
  const legacyStep: LegacyOnboardingStep = 'complete';
  const currentLegacyStep = resolveLegacyCurrentStep(existing);
  const completedSteps = resolveLegacyCompletedSteps(existing);
  const nextCompletedSteps = completedSteps.includes(currentLegacyStep)
    ? completedSteps
    : [...completedSteps, currentLegacyStep];

  const mergedMetadata = mergeLegacyMetadata(
    existing.metadata,
    undefined,
    legacyStep,
    nextCompletedSteps,
  );

  await db
    .update(onboardingProgress)
    .set({
      currentStep: mapLegacyStepToCurrentStep(legacyStep),
      metadata: mergedMetadata,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(onboardingProgress.userId, userId));

  return { ok: true, completedAt: now };
};

export const skipLegacyOnboarding = async (userId: string): Promise<LegacySkipResult> => {
  const existing = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });
  const now = new Date();

  if (!existing) {
    const id = crypto.randomUUID();
    const metadata = mergeLegacyMetadata(undefined, undefined, LEGACY_DEFAULT_STEP, []);

    await db.insert(onboardingProgress).values({
      id,
      userId,
      currentStep: DEFAULT_STEP,
      metadata,
      skippedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true, skippedAt: now };
  }

  if (existing.completedAt) {
    return { ok: false, status: 400, error: ERROR_ONBOARDING_ALREADY_COMPLETED };
  }

  if (existing.skippedAt) {
    return { ok: false, status: 400, error: ERROR_ONBOARDING_ALREADY_SKIPPED };
  }

  const currentLegacyStep = resolveLegacyCurrentStep(existing);
  const completedSteps = resolveLegacyCompletedSteps(existing);
  const mergedMetadata = mergeLegacyMetadata(
    existing.metadata,
    undefined,
    currentLegacyStep,
    completedSteps,
  );

  await db
    .update(onboardingProgress)
    .set({
      metadata: mergedMetadata,
      skippedAt: now,
      updatedAt: now,
    })
    .where(eq(onboardingProgress.userId, userId));

  return { ok: true, skippedAt: now };
};
