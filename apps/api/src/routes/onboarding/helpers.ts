/**
 * Onboarding route helpers.
 *
 * @packageDocumentation
 */

import type { OnboardingMetadata } from '../../db/schema/index.js';

export const ONBOARDING_STEPS = ['intent', 'integrations', 'agenda'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const DEFAULT_STEP: OnboardingStep = 'intent';

export const LEGACY_ONBOARDING_STEPS = [
  'welcome',
  'profile',
  'integrations',
  'preferences',
  'tour',
  'complete',
] as const;
export type LegacyOnboardingStep = (typeof LEGACY_ONBOARDING_STEPS)[number];

export const LEGACY_DEFAULT_STEP: LegacyOnboardingStep = 'welcome';

export const isLegacyOnboardingStep = (value: string): value is LegacyOnboardingStep =>
  LEGACY_ONBOARDING_STEPS.includes(value as LegacyOnboardingStep);

export const mapLegacyStepToCurrentStep = (step: LegacyOnboardingStep): OnboardingStep => {
  if (step === 'integrations') {
    return 'integrations';
  }
  if (step === 'preferences' || step === 'tour' || step === 'complete') {
    return 'agenda';
  }
  return 'intent';
};

export const INTENT_CHIPS = [
  { id: 'organized', label: 'Get more organized', icon: '📋' },
  { id: 'focus', label: 'Focus on what matters', icon: '🎯' },
  { id: 'time', label: 'Better time management', icon: '⏰' },
  { id: 'projects', label: 'Track projects', icon: '📊' },
  { id: 'calendars', label: 'Consolidate my calendars', icon: '📅' },
  { id: 'ai', label: 'AI-powered productivity', icon: '🤖' },
] as const;

type OnboardingTimestampInput = Date | string;
type OptionalOnboardingTimestampInput = Date | string | null | undefined;

type OnboardingMetadataInput = Omit<OnboardingMetadata, 'intent' | 'integrations' | 'agendaApprovedAt'> & {
  intent?: {
    selectedChips: string[];
    customText: string | null;
    confirmedAt: OptionalOnboardingTimestampInput;
  };
  integrations?: {
    provider: string;
    connectedAt: OnboardingTimestampInput;
    syncedEventsCount?: number;
  }[];
  agendaApprovedAt?: OptionalOnboardingTimestampInput;
};

type OnboardingIntent = NonNullable<OnboardingMetadata['intent']>;

const normalizeRequiredTimestamp = (value: OnboardingTimestampInput): string =>
  value instanceof Date ? value.toISOString() : value;

const normalizeOptionalTimestamp = (
  value: OptionalOnboardingTimestampInput,
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
};

export function mergeOnboardingMetadata(
  existing: OnboardingMetadata | null | undefined,
  incoming?: Partial<OnboardingMetadataInput>,
): OnboardingMetadata {
  const base: OnboardingMetadata = { ...(existing ?? {}) };

  if (!incoming) {
    return base;
  }

  if ('conversationId' in incoming) {
    base.conversationId = incoming.conversationId;
  }

  if ('agendaGenerated' in incoming) {
    base.agendaGenerated = incoming.agendaGenerated;
  }

  if ('agendaApprovedAt' in incoming) {
    base.agendaApprovedAt = normalizeOptionalTimestamp(incoming.agendaApprovedAt);
  }

  if ('integrations' in incoming) {
    base.integrations = incoming.integrations?.map((integration) => ({
      ...integration,
      connectedAt: normalizeRequiredTimestamp(integration.connectedAt),
    }));
  }

  if (incoming.intent) {
    const intentUpdate: OnboardingIntent = {
      selectedChips: incoming.intent.selectedChips,
      customText: incoming.intent.customText,
      confirmedAt: normalizeOptionalTimestamp(incoming.intent.confirmedAt) ?? null,
    };

    base.intent = {
      ...(existing?.intent ?? {}),
      ...intentUpdate,
    };
  }

  return base;
}
