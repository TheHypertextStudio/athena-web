/**
 * A save that fails is announced by a notice with Try again, and the control goes back to what is
 * stored.
 *
 * @remarks
 * The Profile page's "Resume drafts" switch is a plain mutation with an optimistic value, so it
 * shows both halves of the behavior: the failure notice, and the revert. The PATCH is answered with
 * a 500 problem document; once the route is lifted, the notice's Try again re-sends the same write.
 */
import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

const PREFERENCES_ROUTE = '**/hub/preferences';

test.use({ serviceWorkers: 'block' });

test.describe('failed saves', () => {
  test('a failed save shows a notice, reverts the control, and retries from the notice', async ({
    page,
  }) => {
    await signUpAndOnboard(page, 'FailureNotice');
    await page.goto('/settings/profile', { waitUntil: 'domcontentloaded' });
    const resume = page.getByRole('switch', { name: /Resume drafts/ });
    await expect(resume).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await expect(resume).toHaveAttribute('aria-checked', 'false');

    await page.route(PREFERENCES_ROUTE, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500 }),
      });
    });

    await resume.click();
    const notice = page.getByRole('alert');
    await expect(notice).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await expect(resume).toHaveAttribute('aria-checked', 'false');

    await page.unroute(PREFERENCES_ROUTE);
    // Settings is a modal shell; pressing the notice must leave it open.
    await notice.getByRole('button', { name: 'Try again' }).click();
    await expect(page).toHaveURL(/\/settings\/profile/);
    await expect(resume).toHaveAttribute('aria-checked', 'true', { timeout: TIMEOUTS.pageReady });
  });
});
