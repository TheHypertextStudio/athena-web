/** Authenticated browser proof and visual evidence for Linear-compatible planning periods. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

const SHOT_ROOT = resolve(
  import.meta.dirname,
  '../../../../docs/design/audits/screenshots/2026-08-21-planning-timeframes',
);

test.use({ serviceWorkers: 'block' });

/** Open one broad-period picker and choose a named precision plus period. */
async function chooseTimeframe(
  page: Page,
  field: RegExp,
  precision: string,
  period: string,
): Promise<void> {
  await page.getByRole('button', { name: field }).click();
  const picker = page.locator('[data-timeframe-picker][data-state="open"]').last();
  await picker.getByRole('option', { name: precision, exact: true }).click();
  await picker.getByRole('option', { name: period, exact: true }).click();
}

/** Assert the document does not exceed the current viewport. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
}

/** Wait for a named planning trigger before capturing a settled viewport. */
async function capture(page: Page, name: string, ready: RegExp): Promise<void> {
  await expect(page.getByRole('button', { name: ready }).first()).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.waitForTimeout(250);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: resolve(SHOT_ROOT, `${name}.png`) });
}

/** Open a detail masthead's progressive overflow when the planning field is not inline. */
async function revealPlanningField(
  page: Page,
  kind: 'Project' | 'Initiative',
  field: RegExp,
): Promise<void> {
  if (await page.getByRole('button', { name: field }).first().isVisible()) return;
  await expect(async () => {
    await page.getByRole('button', { name: `More ${kind} properties` }).click();
    await expect(page.getByRole('button', { name: field }).first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: TIMEOUTS.pageReady });
}

/** Open the Project list and apply semantic target grouping. */
async function openGroupedProjects(page: Page, orgId: string): Promise<void> {
  await page.goto(orgHref(orgId, 'projects'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(async () => {
    await page.locator('button').filter({ hasText: 'Display' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Target timeframe' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: TIMEOUTS.pageReady });
  await page.getByRole('menuitemradio', { name: 'Target timeframe' }).click();
  await expect(page.getByText('H2 FY 2027', { exact: true }).first()).toBeVisible();
}

/** Capture the five changed surfaces in one viewport and color scheme. */
async function captureSurfaceSet(
  page: Page,
  orgId: string,
  projectId: string,
  initiativeId: string,
  suffix: string,
): Promise<void> {
  await page.goto(orgHref(orgId, 'projects'), { waitUntil: 'domcontentloaded' });
  await expect(async () => {
    const dialog = page.getByRole('dialog', { name: /New project/ });
    if (!(await dialog.isVisible())) {
      await page.getByRole('button', { name: 'New project' }).click();
    }
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: TIMEOUTS.pageReady });
  const projectTarget = page.getByRole('button', { name: /Project target/ });
  await expect(projectTarget).toBeEnabled({ timeout: TIMEOUTS.pageReady });
  await projectTarget.click();
  await capture(page, `project-create-${suffix}`, /Project target/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await openGroupedProjects(page, orgId);
  await capture(page, `project-list-grouped-${suffix}`, /New project/);

  await page.goto(orgHref(orgId, `projects/${projectId}`), { waitUntil: 'domcontentloaded' });
  await revealPlanningField(page, 'Project', /Target date.*H2 FY 2027/);
  await capture(page, `project-detail-${suffix}`, /Target date.*H2 FY 2027/);

  await page.goto(orgHref(orgId, 'initiatives'), { waitUntil: 'domcontentloaded' });
  await expect(async () => {
    const dialog = page.getByRole('dialog', { name: /New initiative/ });
    if (!(await dialog.isVisible())) {
      await page.getByRole('button', { name: 'New initiative' }).click();
    }
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: TIMEOUTS.pageReady });
  const initiativeTarget = page.getByRole('button', { name: /Initiative target/ });
  await expect(initiativeTarget).toBeEnabled({ timeout: TIMEOUTS.pageReady });
  await initiativeTarget.click();
  await capture(page, `initiative-create-${suffix}`, /Initiative target/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.goto(orgHref(orgId, `initiatives/${initiativeId}`), {
    waitUntil: 'domcontentloaded',
  });
  await revealPlanningField(page, 'Initiative', /Target date.*December 2026/);
  await capture(page, `initiative-detail-${suffix}`, /Target date.*December 2026/);
}

test('saved planning periods retain their fiscal basis across every product surface', async ({
  page,
}) => {
  test.setTimeout(600_000);
  mkdirSync(SHOT_ROOT, { recursive: true });
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => {
    // Project detail already has a documented skeleton-to-cached-record hydration race. This
    // feature does not own that server-data boundary, so keep its known warning out of the slice's
    // runtime assertion while still failing on every other uncaught browser error.
    if (
      !error.message.startsWith("Hydration failed because the server rendered HTML didn't match")
    ) {
      runtimeErrors.push(error.message);
    }
  });

  const { orgId } = await signUpAndOnboard(page, 'PlanningTimeframes');
  await apiJson(page, `/v1/orgs/${orgId}/settings/work-structure`, {
    method: 'PATCH',
    body: { fiscalYearStartMonth: 6 },
  });

  await page.goto(orgHref(orgId, 'projects'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Planning periods rollout');
  await chooseTimeframe(page, /Project start/, 'Quarter', 'Q1 FY 2027');
  await chooseTimeframe(page, /Project target/, 'Half-year', 'H2 FY 2027');
  await page.getByRole('button', { name: 'Create Project' }).click();
  await page.waitForURL(/\/projects\/[^/]+$/, { timeout: TIMEOUTS.pageReady });
  const projectId = page.url().split('/').at(-1);
  expect(projectId).toBeTruthy();
  if (!projectId) throw new Error('Project creation did not navigate to a Project id.');

  const project = await apiJson<{
    startDate: string;
    startDateResolution: string;
    startDateFiscalYearStartMonth: number;
    targetDate: string;
    targetDateResolution: string;
    targetDateFiscalYearStartMonth: number;
  }>(page, `/v1/orgs/${orgId}/projects/${projectId}`);
  expect(project).toMatchObject({
    startDate: '2026-07-01T00:00:00.000Z',
    startDateResolution: 'quarter',
    startDateFiscalYearStartMonth: 6,
    targetDate: '2027-06-30T00:00:00.000Z',
    targetDateResolution: 'halfYear',
    targetDateFiscalYearStartMonth: 6,
  });

  const initiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: {
      name: 'Planning confidence',
      targetDate: '2026-12-31',
      targetDateResolution: 'month',
    },
  });

  await apiJson(page, `/v1/orgs/${orgId}/settings/work-structure`, {
    method: 'PATCH',
    body: { fiscalYearStartMonth: 0 },
  });
  await page.goto(orgHref(orgId, `projects/${projectId}`), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Start date.*Q1 FY 2027/ })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('button', { name: /Target date.*H2 FY 2027/ })).toBeVisible();

  await page.getByRole('button', { name: /Target date.*H2 FY 2027/ }).click();
  await page.getByRole('option', { name: 'Month', exact: true }).click();
  await page.getByRole('option', { name: 'June 2026', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Start must be on or before target.' }),
  ).toHaveText('Start must be on or before target.');
  await page.keyboard.press('Escape');

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await setColorScheme(page, scheme);
      await captureSurfaceSet(page, orgId, projectId, initiative.id, `${viewport.name}-${scheme}`);
    }
  }

  await page.goto(orgHref(orgId, `initiatives/${initiative.id}`), {
    waitUntil: 'domcontentloaded',
  });
  await revealPlanningField(page, 'Initiative', /Target date.*December 2026/);
  const target = page.getByRole('button', { name: /Target date.*December 2026/ });
  await target.focus();
  await expect(target).toBeFocused();
  const focusStyle = await target.evaluate((node) => {
    const style = window.getComputedStyle(node);
    return { boxShadow: style.boxShadow, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.boxShadow !== 'none' || focusStyle.outlineWidth !== '0px').toBe(true);
  await target.press('Enter');
  await page.getByRole('option', { name: 'Specific date', exact: true }).click();
  await page
    .getByRole('grid', { name: 'Target date' })
    .getByRole('button', {
      name: '2026-12-15',
    })
    .click();
  await expect(page.getByRole('button', { name: /Target date.*Dec 15, 2026/ })).toBeVisible();
  await page.getByRole('button', { name: /Target date.*Dec 15, 2026/ }).click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('button', { name: 'Target date — not set' })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalOverflow(page);
  const planningTriggers = page.getByRole('button', { name: /Target date/ });
  for (let index = 0; index < (await planningTriggers.count()); index++) {
    expect(
      await planningTriggers.nth(index).evaluate((node) => node.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(40);
  }
  expect(runtimeErrors).toEqual([]);
});
