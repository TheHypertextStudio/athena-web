import { test, expect } from '@playwright/test';
import { clearAuthState, setupOnboardingMocks, URLS } from '../fixtures/onboarding.mocks';
import { createOnboardingPage } from '../fixtures/onboarding.page';

test.describe('Onboarding - Integrations step', () => {
  test('renders core provider cards and continue enabled', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, { step: 'integrations' });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('integrations');

    await expect(onboarding.integrations.card('google_calendar')).toBeVisible();
    await expect(onboarding.integrations.card('outlook_calendar')).toBeVisible();
    await expect(onboarding.integrations.card('apple_calendar')).toBeVisible();
    await expect(onboarding.continueButton).toBeEnabled();
  });

  test('connect triggers OAuth request and shows connecting state', async ({ page, context }) => {
    await clearAuthState(context);
    const tracker = await setupOnboardingMocks(page, {
      step: 'integrations',
      authUrl: { delayMs: 800 },
    });

    await page.addInitScript(() => {
      window.open = () =>
        ({
          closed: false,
          close: () => {
            // Mock - no-op
          },
        }) as unknown as Window;
    });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('integrations');

    await onboarding.integrations.action('google_calendar').click();
    await expect(onboarding.integrations.status('google_calendar')).toHaveAttribute(
      'data-status',
      'connecting',
    );

    await expect.poll(() => tracker.authRequests.length).toBe(1);
  });

  test('connected provider shows disconnect action', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, {
      step: 'integrations',
      connections: [{ provider: 'google', email: 'test@gmail.com' }],
    });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('integrations');

    await expect(onboarding.integrations.status('google_calendar')).toHaveAttribute(
      'data-status',
      'success',
    );
    await expect(onboarding.integrations.action('google_calendar')).toHaveText(/disconnect/i);
  });

  test('auth error shows retry action', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, {
      step: 'integrations',
      authUrl: { error: 'OAuth failed' },
    });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('integrations');

    await onboarding.integrations.action('google_calendar').click();
    await expect(onboarding.integrations.status('google_calendar')).toHaveAttribute(
      'data-status',
      'error',
    );
    await expect(onboarding.integrations.action('google_calendar')).toHaveText(/retry/i);
  });
});
