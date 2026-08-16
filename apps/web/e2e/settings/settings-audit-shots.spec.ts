/**
 * Visual evidence for the Settings surface audit.
 *
 * @remarks
 * Walks every routed Settings section — the Personal group and the Workspace group — in both
 * colour schemes and at both viewports. This is the browser verification for the surface,
 * typography, hierarchy and copy passes.
 *
 * ## Why all four combinations
 *
 * The craft rubric's hard gates are light *and* dark verified by screenshot, and no horizontal
 * scroll from 320 up. A light-only capture at one width answers neither, and the settings tree is
 * where a one-sided check fails: this audit began with a tonal ramp running backwards, which is
 * only visible in the relationship between a card and the surface under it. Dark inverts that
 * relationship, so a card that separates in light can vanish in dark with nothing else noticing.
 *
 * The mobile pass also asserts what it photographs. A screenshot shows a narrow layout; it does
 * not show that the page cannot be scrolled sideways, and a single overflowing row is invisible in
 * a capture clipped to the viewport.
 *
 * Evidence, not regression: each case asserts only that the section actually rendered before the
 * shutter, so a shot is never of a skeleton or a redirect landing page.
 */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const SHOT_DIR = new URL(
  '../../../../docs/design/audits/screenshots/2026-08-15-settings-audit/',
  import.meta.url,
).pathname;

/** The Personal group, in registry order. */
const PERSONAL = [
  'profile',
  'athena',
  'connections',
  'connections/google-calendar',
  'connected-accounts',
  'connected-apps',
  'notifications',
  'calendar',
  'work-locations',
  'security',
  'data-privacy',
] as const;

/** The Workspace group, in registry order. */
const WORKSPACE = [
  'general',
  'members',
  'statuses',
  'work-structure',
  'labels',
  'templates',
  'import',
  'automations',
  'connections',
  'connections/google-calendar',
  'connections/notion',
  'publishing',
] as const;

/** A filesystem-safe leaf name for a section path. */
const slug = (section: string): string => section.replace(/\//g, '-');

/**
 * The two viewports the shell behaves differently at.
 *
 * @remarks
 * 1440 is where the section rail docks beside the content; 390 is where the pane becomes two
 * levels and the rail turns into a list you navigate away from.
 */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

/** Both colour schemes, since the tonal ramp has to hold in each. */
const SCHEMES = ['light', 'dark'] as const;

/**
 * Assert the surface fits its viewport horizontally.
 *
 * @remarks
 * Checked rather than eyeballed: a capture is clipped to the viewport, so the one row that
 * overflows is precisely what a screenshot cannot show. 1px of slack absorbs sub-pixel rounding.
 *
 * @param page - The page under test.
 */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

/**
 * Wait for a settings section to be past its skeleton, then shoot the frame.
 *
 * @remarks
 * The settings surface is a modal over the app, so the shot is of the viewport rather than the
 * full page — a `fullPage` capture of a fixed-position dialog photographs the route behind it.
 */
async function shoot(page: Page, name: string): Promise<void> {
  const dialog = page.getByRole('dialog').first();
  await expect(dialog).toBeVisible({ timeout: TIMEOUTS.pageReady });
  // The section's own heading is the first thing that survives the skeleton.
  await expect(dialog.getByRole('heading').first()).toBeVisible({ timeout: TIMEOUTS.pageReady });
  // Settle the dialog's zoom/fade and any first-paint layout shift.
  await page.waitForTimeout(700);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${SHOT_DIR}${name}.png` });
}

test.describe('settings audit evidence', () => {
  test.describe.configure({ mode: 'serial', timeout: 900_000 });

  test('personal and workspace sections', async ({ page, browser }) => {
    const { orgId } = await signUpAndOnboard(page, 'settings-audit');
    const storageState = await page.context().storageState();

    for (const viewport of VIEWPORTS) {
      // The mobile pass runs in its own touch-emulating context rather than by narrowing the
      // desktop one. `pointer: coarse` is what raises every control to the 40px touch target, and
      // Chromium reports a fine pointer at any width unless touch is emulated — so a merely narrow
      // window would photograph 36px controls and call it the phone.
      const touch = viewport.name === 'mobile';
      const context = touch
        ? await browser.newContext({
            storageState,
            viewport: { width: viewport.width, height: viewport.height },
            hasTouch: true,
            isMobile: true,
            ignoreHTTPSErrors: true,
          })
        : null;
      const view = context === null ? page : await context.newPage();
      if (context === null) {
        await view.setViewportSize({ width: viewport.width, height: viewport.height });
      }

      for (const scheme of SCHEMES) {
        await setColorScheme(view, scheme);
        // The desktop light pass keeps the unsuffixed names, so the archive's primary set stays
        // comparable against every capture taken during the audit.
        const suffix =
          viewport.name === 'desktop' && scheme === 'light' ? '' : `-${viewport.name}-${scheme}`;

        for (const section of PERSONAL) {
          await view.goto(`/settings/${section}`, { waitUntil: 'domcontentloaded' });
          await shoot(view, `personal-${slug(section)}${suffix}`);
        }

        for (const section of WORKSPACE) {
          await view.goto(`/orgs/${orgId}/settings/${section}`, { waitUntil: 'domcontentloaded' });
          await shoot(view, `workspace-${slug(section)}${suffix}`);
        }
      }

      await context?.close();
    }
  });

  /**
   * The destructive-confirmation step, which a page shot cannot show.
   *
   * @remarks
   * Deleting an automation rule used to mutate on a single click. A fresh workspace seeds no rules
   * and has only one session, so the reachable destructive action on a clean account is one this
   * spec creates for itself — which is also the honest test, since it exercises create *and*
   * delete rather than assuming fixture state.
   */
  test('confirms deleting an automation rule', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'settings-confirm');
    await page.goto(`/orgs/${orgId}/settings/automations`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'New automation' }).click();
    await page.getByRole('button', { name: 'Create automation' }).click();

    const remove = page.getByRole('button', { name: /^Delete / }).first();
    await expect(remove).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await remove.click();

    const confirm = page.getByRole('dialog', { name: /^Delete / });
    await expect(confirm).toBeVisible({ timeout: TIMEOUTS.ui });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT_DIR}confirm-delete-automation.png` });
  });
});
