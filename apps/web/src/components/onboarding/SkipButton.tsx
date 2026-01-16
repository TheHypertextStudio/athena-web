/**
 * Skip button for exiting onboarding.
 *
 * Always visible to allow users to skip at any step.
 * Skipping preserves any partial progress.
 *
 * @packageDocumentation
 */

'use client';

import { ONBOARDING_TEST_IDS } from './test-ids';

interface SkipButtonProps {
  onSkip: () => void;
  isSkipping?: boolean;
}

/**
 * SkipButton component for skipping onboarding.
 */
export function SkipButton({ onSkip, isSkipping = false }: SkipButtonProps) {
  return (
    <button
      onClick={onSkip}
      disabled={isSkipping}
      className="text-body-medium text-on-surface-variant hover:text-on-surface transition-colors duration-150 disabled:opacity-50"
      data-testid={ONBOARDING_TEST_IDS.skipButton}
    >
      {isSkipping ? 'Skipping...' : 'Skip'}
    </button>
  );
}
