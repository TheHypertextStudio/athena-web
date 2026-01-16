/**
 * Navigation controls for onboarding flow.
 *
 * Provides Back and Continue buttons with appropriate state
 * based on current step.
 *
 * @packageDocumentation
 */

'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { OnboardingStep } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { ONBOARDING_TEST_IDS } from './test-ids';

interface OnboardingNavigationProps {
  step: OnboardingStep;
  canProceed: boolean;
  onBack: () => void;
  onContinue: () => void;
  isLoading?: boolean;
}

const CONTINUE_LABELS: Record<OnboardingStep, string> = {
  intent: 'Continue',
  integrations: 'Continue',
  agenda: 'Looks good',
};

/**
 * OnboardingNavigation component for step navigation.
 */
export function OnboardingNavigation({
  step,
  canProceed,
  onBack,
  onContinue,
  isLoading = false,
}: OnboardingNavigationProps) {
  const showBack = step !== 'intent';
  const continueLabel = CONTINUE_LABELS[step];

  return (
    <div className="flex items-center gap-3">
      {showBack && (
        <Button
          variant="text"
          size="sm"
          onClick={onBack}
          disabled={isLoading}
          className="gap-1"
          data-testid={ONBOARDING_TEST_IDS.backButton}
        >
          <ArrowBackIcon sx={{ fontSize: 18 }} />
          Back
        </Button>
      )}

      <Button
        variant="filled"
        size="sm"
        onClick={onContinue}
        disabled={!canProceed || isLoading}
        data-testid={ONBOARDING_TEST_IDS.continueButton}
      >
        {isLoading ? 'Loading...' : continueLabel}
      </Button>
    </div>
  );
}
