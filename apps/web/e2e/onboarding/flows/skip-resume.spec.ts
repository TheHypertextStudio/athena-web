import { test, expect } from '@playwright/test';
import {
  clearAuthState,
  setupOnboardingMocks,
  mockDashboardData,
  URLS,
} from '../fixtures/onboarding.mocks';
import { createOnboardingPage } from '../fixtures/onboarding.page';

test.describe('Onboarding - Skip and resume', () => {
  test('skip from intent redirects to home', async ({ page, context }) => {
    await clearAuthState(context);
    const tracker = await setupOnboardingMocks(page, { step: 'intent' });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('intent');

    await onboarding.skipButton.click();
    await page.waitForURL('**/home');

    await expect.poll(() => tracker.skips).toBe(1);
  });

  test('resume banner appears when onboarding is skipped', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, { isSkipped: true });
    await mockDashboardData(page);

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.DASHBOARD);

    await expect(onboarding.resumeBanner.root).toBeVisible();
    await expect(onboarding.resumeBanner.resumeButton).toBeVisible();

    await onboarding.resumeBanner.dismissButton.click();
    await expect(onboarding.resumeBanner.root).not.toBeVisible();
  });
});
