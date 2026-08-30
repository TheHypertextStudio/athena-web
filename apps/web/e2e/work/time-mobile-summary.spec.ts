import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test('Time keeps its total and view selector in separate mobile rows', async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndOnboard(page, 'TimeMobileSummary');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/time', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
    await expect(page.getByRole('heading', { name: 'Time' })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });

    const total = page.locator('span').filter({ hasText: /^0m$/ });
    const selector = page.locator('[aria-label="Time view"]');
    await expect(total).toBeVisible();
    await expect(selector).toBeVisible();
    const { totalBottom, selectorTop, widths } = await page.evaluate(() => {
      const total = Array.from(document.querySelectorAll('span')).find(
        (element) => element.textContent === '0m',
      );
      const selector = document.querySelector<HTMLElement>('[aria-label="Time view"]');
      if (!total || !selector) throw new Error('Time summary controls did not render.');
      return {
        totalBottom: total.getBoundingClientRect().bottom,
        selectorTop: selector.getBoundingClientRect().top,
        widths: { document: document.documentElement.scrollWidth, viewport: innerWidth },
      };
    });

    expect(totalBottom).toBeLessThanOrEqual(selectorTop + 1);
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  }
});
