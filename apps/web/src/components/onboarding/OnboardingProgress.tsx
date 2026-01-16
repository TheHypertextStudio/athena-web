/**
 * Progress indicator for onboarding flow.
 *
 * Shows three dots representing the three steps:
 * 1. Intent
 * 2. Integrations
 * 3. Agenda
 *
 * @packageDocumentation
 */

'use client';

import type { OnboardingStep } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ONBOARDING_TEST_IDS } from './test-ids';

interface OnboardingProgressProps {
  step: OnboardingStep;
}

const STEPS: OnboardingStep[] = ['intent', 'integrations', 'agenda'];

const STEP_LABELS: Record<OnboardingStep, string> = {
  intent: 'Share your intent',
  integrations: 'Connect integrations',
  agenda: 'Review your agenda',
};

/**
 * OnboardingProgress component displaying step progress dots.
 */
export function OnboardingProgress({ step }: OnboardingProgressProps) {
  const currentIndex = STEPS.indexOf(step);

  return (
    <div
      className="flex items-center gap-2"
      role="progressbar"
      aria-valuenow={currentIndex + 1}
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-label={`Step ${String(currentIndex + 1)} of ${String(STEPS.length)}: ${STEP_LABELS[step]}`}
      data-testid={ONBOARDING_TEST_IDS.progress}
    >
      {STEPS.map((s, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div key={s} className="flex items-center">
            {/* Dot */}
            <div
              className={cn(
                'h-2.5 w-2.5 rounded-full transition-colors duration-200',
                isCompleted || isCurrent ? 'bg-primary' : 'bg-outline-variant',
              )}
              aria-hidden
            />
            {/* Connector line */}
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  'mx-1.5 h-0.5 w-6 transition-colors duration-200',
                  isCompleted ? 'bg-primary' : 'bg-outline-variant',
                )}
                aria-hidden
              />
            )}
          </div>
        );
      })}
      {/* Screen reader text */}
      <span className="sr-only">{STEP_LABELS[step]}</span>
    </div>
  );
}
