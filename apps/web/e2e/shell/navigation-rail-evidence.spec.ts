/** Authenticated visual evidence for the Material 3 shell navigation rail. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

const SHOT_ROOT = resolve(
  import.meta.dirname,
  '../../../../docs/design/audits/screenshots/2026-08-28-shell-navigation-states',
);

test.use({ serviceWorkers: 'block' });

/** Assert that the shell never expands the document beyond the visible viewport. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

/** Assert that every collapsed-navigation pixel fits Docket's approved compact-width override. */
async function expectCollapsedNavigationRegion(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main#main-content');
    const navigation = document.querySelector<HTMLElement>('aside[aria-label="Navigation"]');
    if (!main || !navigation) throw new Error('The shell navigation and main content must exist');
    return {
      mainStart: main.getBoundingClientRect().left,
      navigationWidth: navigation.getBoundingClientRect().width,
    };
  });

  expect(geometry.mainStart).toBe(80);
  expect(geometry.navigationWidth).toBe(64);
}

/** Assert the role-specific hit boxes and the one visual state layer used by each rail destination. */
async function expectRailInteractionGeometry(page: Page): Promise<void> {
  const primary = page.getByRole('navigation', { name: 'Primary navigation' });
  const selectedDestination = primary.getByRole('link', { name: 'Today', exact: true });
  const selectedIndicator = selectedDestination.locator(
    '[data-slot="navigation-rail-active-indicator"]',
  );
  const selectedLabel = selectedDestination.locator('[data-slot="navigation-rail-label"]');
  const destination = primary.getByRole('link', { name: 'Calendar', exact: true });
  const indicator = destination.locator('[data-slot="navigation-rail-active-indicator"]');
  const stateLayer = destination.locator('[data-slot="navigation-rail-state-layer"]');
  const label = destination.locator('[data-slot="navigation-rail-label"]');
  const expand = page.getByRole('button', { name: 'Expand navigation' });
  const workspace = page.getByRole('button', { name: /Switch workspace/ });
  const workspaceAvatar = workspace.locator('[data-slot="workspace-avatar"]');
  const account = page.getByRole('button', { name: 'Account menu' });

  const selectionPaint = await page.evaluate(() => {
    const resolveColor = (property: string): string => {
      const probe = document.createElement('span');
      probe.style.color = `var(${property})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return {
      indicator: resolveColor('--color-secondary-container'),
      icon: resolveColor('--color-on-secondary-container'),
      label: resolveColor('--color-secondary'),
    };
  });
  await expect(selectedIndicator).toHaveCSS('background-color', selectionPaint.indicator);
  await expect(selectedIndicator.locator('svg')).toHaveCSS('color', selectionPaint.icon);
  await expect(selectedLabel).toHaveCSS('color', selectionPaint.label);
  await expect(selectedIndicator).toHaveCSS('outline-style', 'none');
  expect(await selectedLabel.evaluate((element) => getComputedStyle(element).fontWeight)).toBe(
    await label.evaluate((element) => getComputedStyle(element).fontWeight),
  );

  await expect(destination).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(stateLayer).toHaveCSS('opacity', '0');
  await destination.hover();
  await expect(destination).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(stateLayer).toHaveCSS('opacity', '0.04');

  await page.mouse.down();
  await expect(stateLayer).toHaveCSS('opacity', '0.08');
  await page.mouse.move(500, 500);
  await page.mouse.up();

  await destination.hover();
  await destination.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(destination).toBeFocused();
  await expect(stateLayer).toHaveCSS('opacity', '0.16');
  const focusPaint = await page.evaluate(() => {
    const link = document.querySelector<HTMLElement>(
      'nav[aria-label="Primary navigation"] a[aria-label="Calendar"]',
    );
    const stateLayer = link?.querySelector<HTMLElement>(
      '[data-slot="navigation-rail-active-indicator"]',
    );
    if (!link || !stateLayer) throw new Error('Calendar destination must have a state layer');
    return {
      destinationShadow: getComputedStyle(link).boxShadow,
      indicatorOutlineColor: getComputedStyle(stateLayer).outlineColor,
      indicatorOutlineOffset: getComputedStyle(stateLayer).outlineOffset,
      indicatorOutlineStyle: getComputedStyle(stateLayer).outlineStyle,
      indicatorOutlineWidth: getComputedStyle(stateLayer).outlineWidth,
    };
  });
  expect(focusPaint.destinationShadow).not.toContain('0px 0px 0px 3px');
  expect(focusPaint.indicatorOutlineColor).toBe(selectionPaint.label);
  expect(focusPaint.indicatorOutlineOffset).toBe('2px');
  expect(focusPaint.indicatorOutlineStyle).toBe('solid');
  expect(focusPaint.indicatorOutlineWidth).toBe('3px');

  const focusBounds = await page.evaluate(() => {
    const scrollRegion = document.querySelector<HTMLElement>(
      '[data-slot="navigation-rail-scroll-region"]',
    );
    const indicator = document.querySelector<HTMLElement>(
      'nav[aria-label="Primary navigation"] a[aria-label="Calendar"] [data-slot="navigation-rail-active-indicator"]',
    );
    if (!scrollRegion || !indicator) throw new Error('The focused rail indicator must exist');
    const scrollRegionBox = scrollRegion.getBoundingClientRect();
    const indicatorBox = indicator.getBoundingClientRect();
    const style = getComputedStyle(indicator);
    const outset = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
    return {
      focusLeft: indicatorBox.left - outset,
      focusRight: indicatorBox.right + outset,
      scrollRegionLeft: scrollRegionBox.left,
      scrollRegionRight: scrollRegionBox.right,
    };
  });
  expect(focusBounds.focusLeft).toBeGreaterThanOrEqual(focusBounds.scrollRegionLeft);
  expect(focusBounds.focusRight).toBeLessThanOrEqual(focusBounds.scrollRegionRight);

  await page.mouse.move(500, 500);
  await expect(stateLayer).toHaveCSS('opacity', '0.12');

  const boxes = await Promise.all([
    selectedDestination.boundingBox(),
    primary.getByRole('link', { name: 'My Work', exact: true }).boundingBox(),
    destination.boundingBox(),
    indicator.boundingBox(),
    expand.boundingBox(),
    workspace.boundingBox(),
    workspaceAvatar.boundingBox(),
    account.boundingBox(),
  ]);
  expect(boxes.slice(2)).toEqual([
    expect.objectContaining({ width: 64, height: 56 }),
    expect.objectContaining({ width: 56, height: 32 }),
    expect.objectContaining({ width: 40, height: 40 }),
    expect.objectContaining({ width: 40, height: 40 }),
    expect.objectContaining({ width: 32, height: 32 }),
    expect.objectContaining({ width: 40, height: 40 }),
  ]);
  const [firstDestination, secondDestination] = boxes;
  if (!firstDestination || !secondDestination) {
    throw new Error('The first two rail destinations must have measurable bounds');
  }
  expect(secondDestination.y - (firstDestination.y + firstDestination.height)).toBe(4);

  const labelClearance = await primary
    .locator('[data-slot="navigation-rail-label"]')
    .evaluateAll((labels) =>
      labels.map((label) => {
        const destination = label.closest<HTMLElement>('a, button');
        if (!destination) throw new Error('Every rail label must belong to a destination');
        const destinationBox = destination.getBoundingClientRect();
        const labelBox = label.getBoundingClientRect();
        return {
          top: labelBox.top - destinationBox.top,
          bottom: destinationBox.bottom - labelBox.bottom,
          lineHeight: Number.parseFloat(getComputedStyle(label).lineHeight),
          height: labelBox.height,
        };
      }),
    );
  for (const clearance of labelClearance) {
    expect(clearance.height).toBe(clearance.lineHeight);
    expect(clearance.top).toBeGreaterThanOrEqual(2);
    expect(clearance.bottom).toBeGreaterThanOrEqual(2);
  }
}

/** Create real recent documents so the visual pass exercises saved identity metadata. */
async function seedRecentDocuments(page: Page, orgId: string): Promise<void> {
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name: 'Launch the new workspace' },
  });
  const initiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: { name: 'Improve Docket craft' },
  });
  const program = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/programs`, {
    method: 'POST',
    body: { name: 'Review navigation states' },
  });
  await apiJson(page, `/v1/orgs/${orgId}/display/project/${project.id}`, {
    method: 'PUT',
    body: { iconKey: 'bus', colorKey: 'rose', customColor: '#e11d48' },
  });
  await apiJson(page, `/v1/orgs/${orgId}/display/initiative/${initiative.id}`, {
    method: 'PUT',
    body: { iconKey: 'rocket', colorKey: 'purple', customColor: null },
  });

  await page.evaluate(
    async ({ orgId, projectId, programId, initiativeId }) => {
      const response = await fetch('/api/auth/get-session');
      const session = (await response.json()) as { user?: { id?: string } };
      const userId = session.user?.id;
      if (!userId) throw new Error('An authenticated user is required to seed recent documents');
      sessionStorage.setItem(
        `docket:recent-documents:${userId}`,
        JSON.stringify([
          { type: 'project', orgId, id: projectId, title: 'Launch the new workspace' },
          { type: 'program', orgId, id: programId, title: 'Review navigation states' },
          { type: 'initiative', orgId, id: initiativeId, title: 'Improve Docket craft' },
        ]),
      );
    },
    { orgId, projectId: project.id, programId: program.id, initiativeId: initiative.id },
  );
  await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
}

test('the labeled navigation rail keeps daily work visible at every density', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOT_ROOT, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  const { orgId } = await signUpAndOnboard(page, 'NavigationRailAudit');
  await page.goto('/today', {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: 'Plan today with Athena' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await seedRecentDocuments(page, orgId);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  const collapse = page.getByRole('button', { name: 'Collapse navigation' });
  await expect(collapse).toBeVisible();
  await expect(page.getByRole('link', { name: 'Today' })).toHaveCSS('height', '40px');
  await setColorScheme(page, 'light');
  await page.screenshot({ path: resolve(SHOT_ROOT, 'expanded-1440x900-light.png') });

  await collapse.focus();
  await page.screenshot({ path: resolve(SHOT_ROOT, 'expanded-focus-1440x900-light.png') });
  await collapse.click();
  await page.waitForTimeout(250);

  const primary = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(primary).toHaveText(
    /Today[\s\S]*My Work[\s\S]*Calendar[\s\S]*Inbox[\s\S]*Search[\s\S]*Athena/,
  );
  await expect(page.getByRole('button', { name: 'More navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeFocused();
  await expectCollapsedNavigationRegion(page);
  await expectRailInteractionGeometry(page);
  const recent = page.getByRole('navigation', { name: 'Recent' });
  await expect(recent.getByRole('link')).toHaveCount(3);
  await expect(recent.getByRole('link').first()).toHaveCSS('width', '40px');
  await expect(recent.getByRole('link').first()).toHaveCSS('height', '40px');
  await expect(recent.locator('[data-testid="initiative-icon-circle"]')).toHaveCount(3);
  await expect(recent.getByRole('link').nth(0).locator('[data-icon-key="bus"]')).toHaveCount(1);
  await expect(recent.getByRole('link').nth(1).locator('[data-icon-key="layers"]')).toHaveCount(1);
  await expect(recent.getByRole('link').nth(2).locator('[data-icon-key="rocket"]')).toHaveCount(1);
  await expect(recent.getByRole('link').first().getByTestId('initiative-icon-circle')).toHaveCSS(
    'background-color',
    'rgba(225, 29, 72, 0.15)',
  );
  await expect(page).toHaveURL(/\/today$/);
  await expect(primary.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-1440x900-light.png') });

  await primary.getByRole('link', { name: 'Calendar', exact: true }).hover();
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-hover-1440x900-light.png') });
  await primary.getByRole('link', { name: 'Calendar', exact: true }).focus();
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-focus-1440x900-light.png') });
  await setColorScheme(page, 'dark');
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-1440x900-dark.png') });

  await page.setViewportSize({ width: 1024, height: 900 });
  await setColorScheme(page, 'light');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-1024x900-light.png') });
  await setColorScheme(page, 'dark');
  await page.screenshot({ path: resolve(SHOT_ROOT, 'rail-1024x900-dark.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await setColorScheme(page, 'light');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawerNavigation = page.getByRole('complementary', { name: 'Navigation' }).last();
  await expect(drawerNavigation).toBeVisible();
  await expect
    .poll(() => drawerNavigation.evaluate((element) => element.getBoundingClientRect().left))
    .toBe(0);
  await page.screenshot({ path: resolve(SHOT_ROOT, 'drawer-390x844-light.png') });
  await setColorScheme(page, 'dark');
  await page.screenshot({ path: resolve(SHOT_ROOT, 'drawer-390x844-dark.png') });
});
