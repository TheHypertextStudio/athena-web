/**
 * Visual capture for the `@` menu, the chip, and the hovercard.
 *
 * @remarks
 * `capture-shots.ts` takes routes and captures routes, which cannot reach any of this: the menu and
 * the hovercard are transient overlays that exist only mid-interaction. So these drive the states
 * open and attach them to the report, at both viewports and in both themes, which is the matrix
 * where a tonal step that reads fine in light mode turns invisible in dark.
 *
 * Assertions are deliberately thin. A broken flow should fail the functional spec next door; what
 * these are for is a human looking at the result.
 */
import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { openMentionMenu, seedMentionFixtures, waitForMentionable } from '../helpers/mentions';
import { attachShot, setColorScheme } from '../helpers/ui';

/** The two viewports the rest of the suite captures at. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test.describe('mention visuals', () => {
  for (const viewport of VIEWPORTS) {
    test(`menu, chip, and hovercard (${viewport.name})`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const { orgId } = await signUpAndOnboard(page, `MentionShot${viewport.name}`);
      const { projectId, taskTitle } = await seedMentionFixtures(page, orgId);
      await waitForMentionable(page, orgId, 'zep', taskTitle);

      await page.goto(orgHref(orgId, `projects/${projectId}`), { waitUntil: 'domcontentloaded' });
      const prose = page.locator('section[aria-label="Project document"] [contenteditable="true"]');
      await expect(prose).toBeVisible({ timeout: TIMEOUTS.pageReady });

      await prose.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Blocked by ');
      await openMentionMenu(page, 'z');

      // The grouped menu is the state most worth looking at: it is where a missing separator or a
      // section header at the wrong tonal step shows up.
      await page.waitForTimeout(400);
      await attachShot(testInfo, page, `mention-menu-${viewport.name}-light.png`);
      await setColorScheme(page, 'dark');
      await page.waitForTimeout(250);
      await attachShot(testInfo, page, `mention-menu-${viewport.name}-dark.png`);
      await setColorScheme(page, 'light');

      await page.keyboard.press('Enter');
      const chip = page.locator('[data-mention-kind]').filter({ hasText: taskTitle }).first();
      await expect(chip).toBeVisible();
      await page.waitForTimeout(300);
      await attachShot(testInfo, page, `mention-chip-${viewport.name}-light.png`);

      // The card opens with the title and kind it already has, then fills in — so capture after it
      // settles, which is the frame that shows whether the enrichment rows reserved their space.
      await chip.hover();
      await page.waitForTimeout(900);
      await attachShot(testInfo, page, `mention-hovercard-${viewport.name}-light.png`);
      await setColorScheme(page, 'dark');
      await page.waitForTimeout(250);
      await attachShot(testInfo, page, `mention-hovercard-${viewport.name}-dark.png`);
    });
  }
});
