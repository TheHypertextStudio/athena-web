/** Four-matrix visual evidence for the Stream design audit. */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from './helpers/app';
import { orgHref, TIMEOUTS } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { seedStreamTimeline } from './helpers/stream';
import { setColorScheme } from './helpers/ui';

const SHOT_DIR = new URL(
  '../../../docs/design/audits/screenshots/2026-08-11-stream/',
  import.meta.url,
).pathname;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

/** Capture the visible application frame into the durable design-audit archive. */
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}${name}`, fullPage: true });
}

for (const viewport of VIEWPORTS) {
  test(`Stream timeline in both themes (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { orgId } = await signUpAndOnboard(page, `StreamShot${viewport.name}`);
    await seedStreamTimeline(page, orgId);
    await page.goto(orgHref(orgId, 'stream'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('main').getByText('Ship the beta')).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });

    await setColorScheme(page, 'light');
    await shot(page, `stream-${viewport.name}-light.png`);
    await setColorScheme(page, 'dark');
    await shot(page, `stream-${viewport.name}-dark.png`);
  });
}
