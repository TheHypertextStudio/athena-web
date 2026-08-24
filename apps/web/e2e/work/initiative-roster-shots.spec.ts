/**
 * Visual evidence for the Initiative roster columns and hierarchy rails.
 *
 * @remarks
 * The roster needs two roots, several siblings, and a single-child branch to expose every rail
 * boundary allowed by the workspace's default two-level hierarchy. Each screenshot covers the same
 * data in both themes and at the reported desktop width plus a narrower application frame.
 */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

const SHOT_DIR = new URL(
  '../../../../docs/design/audits/screenshots/2026-08-23-initiative-roster/',
  import.meta.url,
).pathname;

const VIEWPORTS = [
  { name: 'desktop', width: 1320, height: 900 },
  { name: 'narrow', width: 960, height: 900 },
] as const;

/** Create one Initiative through the signed-in browser session. */
async function createInitiative(page: Page, orgId: string, name: string): Promise<string> {
  return (
    await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
      method: 'POST',
      body: { name },
    })
  ).id;
}

/** Connect two Initiatives in the hierarchy through the public relationship endpoint. */
async function connectInitiatives(
  page: Page,
  orgId: string,
  parentInitiativeId: string,
  childInitiativeId: string,
): Promise<void> {
  await apiJson(page, `/v1/orgs/${orgId}/initiatives/hierarchy-links`, {
    method: 'POST',
    body: { parentInitiativeId, childInitiativeId },
  });
}

test('Initiative roster fits its columns and stops rails at subtree boundaries', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { orgId } = await signUpAndOnboard(page, 'InitiativeRoster');
  const rootA = await createInitiative(page, orgId, 'Transit access');
  const firstA = await createInitiative(page, orgId, 'Regional service');
  const lastA = await createInitiative(page, orgId, 'Accessible stops');
  const rootB = await createInitiative(page, orgId, 'Safe streets');
  const onlyB = await createInitiative(page, orgId, 'Protected crossings');

  await connectInitiatives(page, orgId, rootA, firstA);
  await connectInitiatives(page, orgId, rootA, lastA);
  await connectInitiatives(page, orgId, rootB, onlyB);

  await page.goto(orgHref(orgId, 'initiatives'), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: 'Initiatives' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByText('Protected crossings', { exact: true })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  await expect(page.getByRole('columnheader', { name: 'Active Project count' })).toHaveCount(0);
  await page.setViewportSize({ width: 1320, height: 900 });
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
    .locator(`[data-row-id="${lastA}"]`)
    .getByTestId('initiative-hierarchy-rail');
  await expect(lastSiblingRail).toBeVisible();
  expect(
    await lastSiblingRail
      .locator('line')
      .evaluateAll((lines) =>
        lines.map((line) => ({ x: line.getAttribute('x1'), y2: line.getAttribute('y2') })),
      ),
  ).toEqual([{ x: '28', y2: '25' }]);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const scheme of ['light', 'dark'] as const) {
      await setColorScheme(page, scheme);
      await page.screenshot({
        path: `${SHOT_DIR}initiatives-${viewport.name}-${scheme}.png`,
        fullPage: true,
      });
    }
  }
});
