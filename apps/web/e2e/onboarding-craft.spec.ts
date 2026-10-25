import { expect, test } from './helpers/fixtures';
import { signUpAndOnboard } from './helpers/app';

const session = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (session) test.use({ storageState: session });
test.beforeEach(async ({ page }) => {
  if (!session) await signUpAndOnboard(page, 'OnboardingCraft');
});

test('keeps optional setup usable with reduced motion at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Just me', exact: false }).click();
  const title = page.getByRole('heading', { name: 'Bring in your work' });
  await expect(title).toBeVisible();
  const motion = await title.evaluate((element) => {
    const step = element.closest('[class*=animate-in]');
    return step ? getComputedStyle(step).animationName : null;
  });
  expect(motion).toBe('none');
  await expect(page.getByRole('button', { name: 'Continue without connecting' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'Continue without connecting' }).click();
  await expect(page.getByRole('button', { name: 'Choose starting work' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/today$/);
});

test('keeps optional setup usable with 200-percent text and keyboard activation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/onboarding');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.locator('body').evaluate((element) => getComputedStyle(element).fontSize)).toBe(
    '32px',
  );
  const personal = page.getByRole('button', { name: 'Just me', exact: false });
  await personal.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Bring in your work' })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.locator('body').evaluate((element) => getComputedStyle(element).fontSize)).toBe(
    '32px',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const next = page.getByRole('button', { name: 'Continue without connecting' });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Choose starting work' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'Skip for now' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/today$/);
});
