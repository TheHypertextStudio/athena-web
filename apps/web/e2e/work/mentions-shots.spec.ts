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
import { descriptionEditor } from '../helpers/editors';

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
      const prose = descriptionEditor(page);
      await expect(prose).toBeVisible({ timeout: TIMEOUTS.pageReady });

      await prose.click();
      await page.keyboard.press('End');
      await prose.pressSequentially(' Blocked by ');
      await openMentionMenu(prose, 'z');

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

  test('grouped rows do not overlap at narrow width and 200% root text scale', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { orgId } = await signUpAndOnboard(page, 'MentionScale');
    const { projectId, taskTitle } = await seedMentionFixtures(page, orgId);
    await waitForMentionable(page, orgId, 'zep', taskTitle);

    await page.goto(orgHref(orgId, `projects/${projectId}`), { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const prose = descriptionEditor(page);
    await expect(prose).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await prose.click();
    await page.keyboard.press('End');
    await prose.pressSequentially(' Depends on ');
    await openMentionMenu(prose, 'zep');
    const listbox = page.getByRole('listbox', { name: 'Mention a resource' });
    await expect(listbox.getByRole('group')).toHaveCount(2);

    for (const scheme of ['light', 'dark'] as const) {
      await setColorScheme(page, scheme);
      await page.waitForTimeout(250);
      const geometry = await listbox.evaluate((list) => {
        const groups = Array.from(list.querySelectorAll<HTMLElement>(':scope > [role="group"]'));
        const overlaps: string[] = [];
        for (const [groupIndex, group] of groups.entries()) {
          const heading = group.querySelector<HTMLElement>(':scope > p');
          const rows = Array.from(group.querySelectorAll<HTMLElement>('[role="option"]'));
          if (heading && rows[0]) {
            const headingRect = heading.getBoundingClientRect();
            const firstRowRect = rows[0].getBoundingClientRect();
            if (headingRect.bottom > firstRowRect.top + 0.5) {
              overlaps.push(`group ${groupIndex} heading overlaps its first row`);
            }
          }
          for (const [rowIndex, row] of rows.entries()) {
            const rowRect = row.getBoundingClientRect();
            const children = Array.from(row.children)
              .map((child) => child.getBoundingClientRect())
              .filter((rect) => rect.width > 0 && rect.height > 0)
              .sort((left, right) => left.left - right.left);
            for (const rect of children) {
              if (
                rect.left < rowRect.left - 0.5 ||
                rect.right > rowRect.right + 0.5 ||
                rect.top < rowRect.top - 0.5 ||
                rect.bottom > rowRect.bottom + 0.5
              ) {
                overlaps.push(`group ${groupIndex} row ${rowIndex} child escapes the row`);
              }
            }
            for (let index = 1; index < children.length; index += 1) {
              if ((children[index - 1]?.right ?? 0) > (children[index]?.left ?? 0) + 0.5) {
                overlaps.push(`group ${groupIndex} row ${rowIndex} children overlap`);
              }
            }
          }
        }
        return { groupCount: groups.length, overlaps };
      });

      expect(geometry.groupCount).toBeGreaterThanOrEqual(2);
      expect(geometry.overlaps).toEqual([]);
      await attachShot(testInfo, page, `mention-menu-mobile-200-percent-${scheme}.png`);
    }
  });
});
