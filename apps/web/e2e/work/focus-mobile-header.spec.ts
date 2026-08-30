/** Rendered mobile geometry contract for the standalone Focus app bar. */
import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test('Focus keeps its return control out of the title lane on a phone', async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndOnboard(page, 'FocusMobileHeader');
  await page.goto('/focus', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });

  const header = page.locator('[data-slot="shell-top-bar"]');
  const returnControl = header.getByRole('button', { name: 'Return to workspace' });
  const title = header.getByRole('heading', { name: 'Focus mode' });
  await expect(returnControl).toBeVisible();
  await expect(title).toBeVisible();

  const geometry = await header.evaluate((element) => {
    const returnControl = element.querySelector<HTMLElement>(
      'button[aria-label="Return to workspace"]',
    );
    const title = element.querySelector<HTMLElement>('h1');
    if (!returnControl || !title) throw new Error('Focus compact header is incomplete.');
    return {
      returnRight: returnControl.getBoundingClientRect().right,
      titleLeft: title.getBoundingClientRect().left,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });

  expect(geometry.returnRight).toBeLessThanOrEqual(geometry.titleLeft + 1);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
});
