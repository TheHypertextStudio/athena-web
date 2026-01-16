import { test, expect } from '@playwright/test';
import {
  clearAuthState,
  setupOnboardingMocks,
  INTENT_CHIPS,
  URLS,
} from '../fixtures/onboarding.mocks';
import { createOnboardingPage } from '../fixtures/onboarding.page';

test.describe('Onboarding - Intent step', () => {
  test('renders chips and disables continue until input', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, { step: 'intent' });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('intent');

    await expect(onboarding.intent.chips).toHaveCount(INTENT_CHIPS.length);
    await expect(onboarding.continueButton).toBeDisabled();
  });

  test('chip selection toggles and gates continue', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, { step: 'intent' });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('intent');

    const chip = onboarding.intent.chip('focus');
    await chip.click();
    await expect(chip).toHaveAttribute('data-selected', 'true');
    await expect(onboarding.continueButton).toBeEnabled();

    await chip.click();
    await expect(chip).toHaveAttribute('data-selected', 'false');
    await expect(onboarding.continueButton).toBeDisabled();
  });

  test('custom text enables continue and is counted', async ({ page, context }) => {
    await clearAuthState(context);
    await setupOnboardingMocks(page, { step: 'intent' });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('intent');

    const note = 'I want to plan my week';
    await onboarding.intent.customText.fill(note);
    await expect(onboarding.intent.counter).toHaveText(`${String(note.length)}/500`);
    await expect(onboarding.continueButton).toBeEnabled();

    await onboarding.intent.customText.fill('');
    await expect(onboarding.continueButton).toBeDisabled();
  });

  test('continue sends intent metadata and advances', async ({ page, context }) => {
    await clearAuthState(context);
    const tracker = await setupOnboardingMocks(page, { step: 'intent' });

    const onboarding = createOnboardingPage(page);
    await page.goto(URLS.ONBOARDING);
    await onboarding.waitForStep('intent');

    await onboarding.intent.chip('focus').click();
    await onboarding.intent.customText.fill('Working on a launch');
    await onboarding.continueButton.click();

    await onboarding.waitForStep('integrations');

    await expect.poll(() => tracker.stepUpdates.length).toBe(1);
    expect(tracker.stepUpdates[0]?.step).toBe('integrations');
    expect(tracker.stepUpdates[0]?.metadata?.intent).toMatchObject({
      selectedChips: ['focus'],
      customText: 'Working on a launch',
    });
  });
});
