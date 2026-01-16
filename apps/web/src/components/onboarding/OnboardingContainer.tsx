/**
 * Main container for the onboarding flow.
 *
 * Orchestrates the split-screen layout and step transitions between:
 * - Intent (step 1)
 * - Integrations (step 2)
 * - Agenda (step 3)
 *
 * @packageDocumentation
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useOnboarding } from '@/hooks/use-onboarding';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AthenaPanel } from './AthenaPanel';
import { IntentSurface } from './surfaces/IntentSurface';
import { IntegrationsSurface } from './surfaces/IntegrationsSurface';
import { AgendaSurface } from './surfaces/AgendaSurface';
import { OnboardingProgress } from './OnboardingProgress';
import { OnboardingNavigation } from './OnboardingNavigation';
import { SkipButton } from './SkipButton';
import { ONBOARDING_TEST_IDS } from './test-ids';

/**
 * OnboardingContainer component.
 * Root container for the onboarding experience.
 */
export function OnboardingContainer() {
  const {
    currentStep,
    isLoading,
    error,
    canProceed,
    goToNextStep,
    goToPrevStep,
    skipOnboarding,
    completeOnboarding,
    isUpdating,
    isCompleting,
    isSkipping,
    actionError,
    setActionError,
    // AI conversation
    fetchGreeting,
    notifyAthena,
    messages,
    // State for intent
    selectedChips,
    customText,
    availableChips,
    athenaState,
  } = useOnboarding();

  const prefersReducedMotion = useReducedMotion();
  const greetingFetched = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const previousStep = useRef(currentStep);

  // Transition config respecting reduced motion preference
  const surfaceTransition = prefersReducedMotion ? { duration: 0 } : { duration: 0.2 };

  // Fetch Athena's greeting using AI
  useEffect(() => {
    if (!isLoading && messages.length === 0 && !greetingFetched.current) {
      greetingFetched.current = true;
      void fetchGreeting();
    }
  }, [isLoading, messages.length, fetchGreeting]);

  // Focus management: move focus to surface when step changes
  useEffect(() => {
    if (previousStep.current !== currentStep && surfaceRef.current) {
      // Find the first focusable element in the new surface
      const focusable = surfaceRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      // Small delay to allow animation to start
      setTimeout(() => {
        if (focusable) {
          focusable.focus();
        } else {
          surfaceRef.current?.focus();
        }
      }, 100);
    }
    previousStep.current = currentStep;
  }, [currentStep]);

  // Skip link handler
  const handleSkipToContent = useCallback(() => {
    surfaceRef.current?.focus();
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 p-4"
        data-testid={ONBOARDING_TEST_IDS.error.root}
      >
        <h1 className="text-headline-medium text-on-surface">Something went wrong</h1>
        <p className="text-body-large text-on-surface-variant">{error}</p>
        <button
          onClick={() => {
            window.location.reload();
          }}
          data-testid={ONBOARDING_TEST_IDS.error.retry}
          className="bg-primary text-on-primary rounded-full px-6 py-3"
        >
          Try Again
        </button>
      </div>
    );
  }

  const handleContinue = () => {
    setActionError(null);
    // Notify Athena about user's action based on current step
    // Athena will decide whether to advance via tool calls
    switch (currentStep) {
      case 'intent': {
        // Get the labels for selected chips
        const chipLabels = selectedChips
          .map((id) => availableChips.find((c) => c.id === id)?.label)
          .filter(Boolean);

        void notifyAthena('intent_selected', {
          chips: chipLabels,
          customText: customText || undefined,
        });
        // Also advance the step directly since the AI might be slow
        void goToNextStep();
        break;
      }
      case 'integrations':
        void notifyAthena('ready_for_agenda', {});
        void goToNextStep();
        break;
      case 'agenda':
        void notifyAthena('agenda_approved', {});
        void completeOnboarding();
        break;
    }
  };

  const handleBack = () => {
    setActionError(null);
    void goToPrevStep();
  };

  const handleSkip = () => {
    setActionError(null);
    void skipOnboarding();
  };

  return (
    <div className="bg-surface min-h-screen" data-testid={ONBOARDING_TEST_IDS.root}>
      {/* Skip to content link for keyboard users */}
      <a
        href="#onboarding-content"
        onClick={(e) => {
          e.preventDefault();
          handleSkipToContent();
        }}
        data-testid={ONBOARDING_TEST_IDS.skipLink}
        className={cn(
          'fixed top-4 left-4 z-50 -translate-y-16 rounded-lg',
          'bg-primary text-on-primary px-4 py-2',
          'focus:ring-primary-container focus:translate-y-0 focus:ring-2 focus:outline-none',
          'transition-transform',
        )}
      >
        Skip to content
      </a>

      {/* Main content area - split on desktop, stacked on mobile */}
      <div className="flex min-h-screen flex-col lg:flex-row">
        {/* Athena Panel - left side on desktop, top on mobile */}
        <aside
          className={cn(
            'flex flex-col',
            'lg:border-outline-variant lg:w-1/2 lg:max-w-[600px] lg:border-r',
            'max-h-[40vh] lg:max-h-none lg:min-h-screen',
          )}
          aria-label="Athena assistant"
        >
          <AthenaPanel step={currentStep} />
        </aside>

        {/* Surface Area - right side on desktop, bottom on mobile */}
        <main className="flex flex-1 flex-col" id="onboarding-content">
          {/* Skip button - top right */}
          <div className="flex justify-end p-4">
            <SkipButton onSkip={handleSkip} isSkipping={isSkipping} />
          </div>

          {actionError && (
            <div className="px-4 lg:px-8">
              <div
                role="alert"
                data-testid={ONBOARDING_TEST_IDS.actionError}
                className={cn(
                  'border-error/40 bg-error/10 text-on-surface mb-4 flex items-start justify-between gap-4 rounded-lg border px-4 py-3',
                )}
              >
                <p className="text-body-small">{actionError}</p>
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => {
                    setActionError(null);
                  }}
                  data-testid={ONBOARDING_TEST_IDS.actionErrorDismiss}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {/* Current step surface */}
          <div
            ref={surfaceRef}
            tabIndex={-1}
            className="flex-1 overflow-y-auto px-4 pb-32 outline-none lg:px-8"
          >
            <AnimatePresence mode="wait">
              {currentStep === 'intent' && (
                <motion.div
                  key="intent"
                  initial={{ opacity: prefersReducedMotion ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: prefersReducedMotion ? 1 : 0 }}
                  transition={surfaceTransition}
                >
                  <IntentSurface />
                </motion.div>
              )}
              {currentStep === 'integrations' && (
                <motion.div
                  key="integrations"
                  initial={{ opacity: prefersReducedMotion ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: prefersReducedMotion ? 1 : 0 }}
                  transition={surfaceTransition}
                >
                  <IntegrationsSurface />
                </motion.div>
              )}
              {currentStep === 'agenda' && (
                <motion.div
                  key="agenda"
                  initial={{ opacity: prefersReducedMotion ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: prefersReducedMotion ? 1 : 0 }}
                  transition={surfaceTransition}
                >
                  <AgendaSurface />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Fixed bottom bar with progress and navigation */}
      <nav
        className={cn(
          'fixed right-0 bottom-0 left-0 z-40',
          'bg-surface-container border-outline-variant border-t',
          'px-4 py-3',
        )}
        aria-label="Onboarding navigation"
        data-testid={ONBOARDING_TEST_IDS.navigation}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <OnboardingProgress step={currentStep} />
          <OnboardingNavigation
            step={currentStep}
            canProceed={canProceed()}
            onBack={handleBack}
            onContinue={handleContinue}
            isLoading={isUpdating || isCompleting || athenaState === 'thinking'}
          />
        </div>
      </nav>
    </div>
  );
}
