import { test, expect } from '@playwright/test';
import {
  clearAuthState,
  setupOnboardingMocks,
  MOCK_AGENDA_BLOCKS,
  URLS,
} from '../fixtures/onboarding.mocks';
import { createOnboardingPage } from '../fixtures/onboarding.page';

test.describe('Onboarding - Completion flow', () => {
  test('completes a straight-through onboarding journey', async ({ page, context }) => {
    await clearAuthState(context);
    const tracker = await setupOnboardingMocks(page, { step: 'intent' });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('intent');

    await onboarding.intent.chip('focus').click();
    await onboarding.continueButton.click();
    await onboarding.waitForStep('integrations');

    await onboarding.continueButton.click();
    await onboarding.waitForStep('agenda');

    await expect(onboarding.agenda.entries).toHaveCount(MOCK_AGENDA_BLOCKS.length);
    await expect(onboarding.continueButton).toBeEnabled();

    await onboarding.continueButton.click();
    await page.waitForURL('**/home');

    await expect.poll(() => tracker.completes).toBe(1);
    expect(tracker.stepUpdates.map((update) => update.step)).toEqual(['integrations', 'agenda']);
  });
});
