import { test, expect } from '@playwright/test';
import {
  clearAuthState,
  setupOnboardingMocks,
  MOCK_AGENDA_BLOCKS,
  URLS,
} from '../fixtures/onboarding.mocks';
import { createOnboardingPage } from '../fixtures/onboarding.page';

test.describe('Onboarding - Agenda step', () => {
  test('shows loading then renders generated agenda', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, { step: 'agenda' });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('agenda');

    await expect(onboarding.agenda.loading).toBeVisible();
    await expect(onboarding.agenda.entries).toHaveCount(MOCK_AGENDA_BLOCKS.length);
    await expect(onboarding.agenda.loading).not.toBeVisible();
  });

  test('continue enables after agenda generation', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, {
      step: 'agenda',
      agenda: { delayMs: 800 },
    });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('agenda');

    await expect(onboarding.continueButton).toBeDisabled();
    await expect(onboarding.continueButton).toBeEnabled();
  });

  test('shows empty state when no blocks returned', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, {
      step: 'agenda',
      agenda: { blocks: [] },
    });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('agenda');

    await expect(onboarding.agenda.empty).toBeVisible();
    await expect(onboarding.agenda.entries).toHaveCount(0);
  });

  test('regenerate triggers a new agenda request', async ({ page, context }) => {
    await clearAuthState(context);
    const tracker = await setupOnboardingMocks(page, { step: 'agenda' });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('agenda');

    await expect(onboarding.agenda.entries).toHaveCount(MOCK_AGENDA_BLOCKS.length);
    await expect.poll(() => tracker.agendaRequests.length).toBe(1);

    await onboarding.agenda.regenerate.click();
    await expect(onboarding.agenda.loading).toBeVisible();
    await expect.poll(() => tracker.agendaRequests.length).toBe(2);
  });
});
