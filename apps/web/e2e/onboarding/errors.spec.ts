import { test, expect } from '@playwright/test';
import { clearAuthState, setupOnboardingMocks, URLS } from './fixtures/onboarding.mocks';
import { createOnboardingPage } from './fixtures/onboarding.page';

test.describe('Onboarding - Error handling', () => {
  test('shows error screen when status load fails', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, { statusError: 'Failed to load onboarding' });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);

    await expect(onboarding.errorScreen).toBeVisible();
    await expect(onboarding.errorRetry).toBeVisible();
  });

  test('shows inline error when step update fails', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, {
      step: 'intent',
      stepUpdateError: 'Failed to update step',
    });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('intent');

    await onboarding.intent.chip('focus').click();
    await onboarding.continueButton.click();

    await expect(onboarding.actionError).toBeVisible();
    await expect(onboarding.intent.surface).toBeVisible();
  });

  test('shows inline error when agenda generation fails', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, {
      step: 'agenda',
      agenda: { error: 'Generation failed' },
    });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('agenda');

    await expect(onboarding.actionError).toBeVisible();
  });
});
