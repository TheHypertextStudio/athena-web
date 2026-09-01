/**
 * Visual evidence for the Initiative roster columns and hierarchy rails.
 *
 * @remarks
 * The shared release fixture includes two roots, five hierarchy depths, duplicate group context,
 * long titles, and a paged group. Each screenshot covers that data at the three required widths.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import {
  ROSTER_LONG_TITLES,
  ROSTER_VIEWS,
  seedWorkRosterFixture,
  selectRosterView,
} from '../helpers/roster';
import { setColorScheme } from '../helpers/ui';

const SHOT_DIR = resolve(
  import.meta.dirname,
  '../../../../docs/design/audits/screenshots/2026-08-28-work-roster',
);

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'medium', width: 1016, height: 1724 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test('Initiative roster fits its columns and stops rails at subtree boundaries', async ({
  page,
}) => {
  test.setTimeout(600_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const { orgId: personalOrganizationId } = await signUpAndOnboard(page, 'InitiativeRoster');
  const fixture = await seedWorkRosterFixture(page, personalOrganizationId);

  await page.goto(orgHref(fixture.organizationId, 'initiatives'), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: 'Initiatives' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await selectRosterView(page, ROSTER_VIEWS.initiativeGrouped);
  await expect(page.getByText(ROSTER_LONG_TITLES.depthFive, { exact: true }).first()).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  await expect(page.getByRole('columnheader', { name: 'Active Project count' })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  const collapsePanel = page
    .locator('nav[aria-label="Panels"]')
    .getByRole('button', { name: /^Collapse / });
  if (await collapsePanel.isVisible()) {
    await collapsePanel.click();
    await page.waitForTimeout(300);
  }
  const health = page.getByRole('columnheader', { name: 'Health', exact: true });
  await expect(health).toBeVisible();
  expect(await health.evaluate((element) => element.getBoundingClientRect().width)).toBe(96);

  const lastSiblingRail = page
    .locator(`[data-row-id="${fixture.laterSiblingId}"]`)
    .getByTestId('initiative-hierarchy-rail');
  await expect(lastSiblingRail).toBeVisible();
  expect(
    await lastSiblingRail
      .locator('line')
      .evaluateAll((lines) =>
        lines.map((line) => ({ x: line.getAttribute('x1'), y2: line.getAttribute('y2') })),
      ),
  ).toEqual([{ x: '16', y2: '16' }]);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-overlay-scrim]')).toHaveCount(0);
    for (const scheme of ['light', 'dark'] as const) {
      await setColorScheme(page, scheme);
      await page.waitForTimeout(300);
      await page.screenshot({
        path: resolve(SHOT_DIR, `initiatives-${viewport.name}-${scheme}.png`),
        fullPage: true,
      });
    }
  }
});
