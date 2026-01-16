/**
 * Page object helpers for onboarding flow.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { ONBOARDING_TEST_IDS } from '../../../src/components/onboarding/test-ids';
import type { OnboardingStep } from './onboarding.mocks';

const stepTestIds: Record<OnboardingStep, string> = {
  intent: ONBOARDING_TEST_IDS.intent.surface,
  integrations: ONBOARDING_TEST_IDS.integrations.surface,
  agenda: ONBOARDING_TEST_IDS.agenda.surface,
};

export function createOnboardingPage(page: Page) {
  const byTestId = (id: string) => page.getByTestId(id);

  const agendaEntries = page.locator('[data-entry-id^="onboarding-"]');

  return {
    page,
    waitForStep: async (step: OnboardingStep) => {
      await expect(byTestId(stepTestIds[step])).toBeVisible();
    },
    continueButton: byTestId(ONBOARDING_TEST_IDS.continueButton),
    backButton: byTestId(ONBOARDING_TEST_IDS.backButton),
    skipButton: byTestId(ONBOARDING_TEST_IDS.skipButton),
    actionError: byTestId(ONBOARDING_TEST_IDS.actionError),
    errorScreen: byTestId(ONBOARDING_TEST_IDS.error.root),
    errorRetry: byTestId(ONBOARDING_TEST_IDS.error.retry),
    intent: {
      surface: byTestId(ONBOARDING_TEST_IDS.intent.surface),
      heading: byTestId(ONBOARDING_TEST_IDS.intent.heading),
      subheading: byTestId(ONBOARDING_TEST_IDS.intent.subheading),
      chip: (id: string) => byTestId(ONBOARDING_TEST_IDS.intent.chip(id)),
      chips: page.locator('[data-intent-chip]'),
      customText: byTestId(ONBOARDING_TEST_IDS.intent.customText),
      counter: byTestId(ONBOARDING_TEST_IDS.intent.counter),
    },
    integrations: {
      surface: byTestId(ONBOARDING_TEST_IDS.integrations.surface),
      card: (provider: string) => byTestId(ONBOARDING_TEST_IDS.integrations.card(provider)),
      status: (provider: string) => byTestId(ONBOARDING_TEST_IDS.integrations.status(provider)),
      action: (provider: string) => byTestId(ONBOARDING_TEST_IDS.integrations.action(provider)),
    },
    agenda: {
      surface: byTestId(ONBOARDING_TEST_IDS.agenda.surface),
      loading: byTestId(ONBOARDING_TEST_IDS.agenda.loading),
      empty: byTestId(ONBOARDING_TEST_IDS.agenda.empty),
      calendar: byTestId(ONBOARDING_TEST_IDS.agenda.calendar),
      regenerate: byTestId(ONBOARDING_TEST_IDS.agenda.regenerate),
      entries: agendaEntries,
    },
    resumeBanner: {
      root: byTestId(ONBOARDING_TEST_IDS.resumeBanner.root),
      resumeButton: byTestId(ONBOARDING_TEST_IDS.resumeBanner.resumeButton),
      dismissButton: byTestId(ONBOARDING_TEST_IDS.resumeBanner.dismissButton),
    },
  };
}

export async function expectCount(locator: Locator, count: number): Promise<void> {
  await expect(locator).toHaveCount(count);
}
