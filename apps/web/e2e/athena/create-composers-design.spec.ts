/**
 * Visual and geometry acceptance for every create composer with a product entry point.
 *
 * @remarks
 * Task, Project, Initiative, Program, and Team open through the application shell. Cycle creation
 * has no product entry point, so its shared-shell behavior stays covered by the component suite.
 * This browser suite captures both themes at the rubric's desktop and mobile widths and probes the
 * narrowest supported width for horizontal overflow.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { myWorkHref, orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const SHOT_DIR = resolve(
  import.meta.dirname,
  '../../../../docs/design/audits/screenshots/2026-09-08-create-composers',
);

interface ComposerCase {
  readonly slug: string;
  readonly path: (orgId: string) => string;
  readonly trigger: string;
  readonly dialog: string;
  readonly submit: string;
  readonly properties: string | null;
}

const COMPOSERS: readonly ComposerCase[] = [
  {
    slug: 'task',
    path: myWorkHref,
    trigger: 'New task',
    dialog: 'New task',
    submit: 'Create task',
    properties: 'Task properties',
  },
  {
    slug: 'project',
    path: (orgId) => orgHref(orgId, 'projects'),
    trigger: 'New project',
    dialog: 'New project',
    submit: 'Create Project',
    properties: 'Project properties',
  },
  {
    slug: 'initiative',
    path: (orgId) => orgHref(orgId, 'initiatives'),
    trigger: 'New initiative',
    dialog: 'New initiative',
    submit: 'Create Initiative',
    properties: 'Initiative properties',
  },
  {
    slug: 'program',
    path: (orgId) => orgHref(orgId, 'programs'),
    trigger: 'New program',
    dialog: 'New program',
    submit: 'Create Program',
    properties: 'Program properties',
  },
  {
    slug: 'team',
    path: (orgId) => orgHref(orgId, 'teams'),
    trigger: 'New team',
    dialog: 'New team',
    submit: 'Create Team',
    properties: null,
  },
];

async function openComposer(page: Page, orgId: string, item: ComposerCase): Promise<Locator> {
  await page.goto(item.path(orgId), { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  const dialog = page.getByRole('dialog', { name: item.dialog });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.getByRole('button', { name: item.trigger }).first().click();
    }
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: TIMEOUTS.pageReady });
  return dialog;
}

async function expectTwoFooterRows(dialog: Locator, item: ComposerCase): Promise<void> {
  if (item.properties === null) return;
  const propertyRow = dialog.getByRole('group', { name: item.properties });
  const actionRow = dialog.getByRole('button', { name: item.submit }).locator('..');
  const [propertyBox, actionBox] = await Promise.all([
    propertyRow.evaluate((node) => node.getBoundingClientRect()),
    actionRow.evaluate((node) => node.getBoundingClientRect()),
  ]);
  expect(propertyBox.bottom).toBeLessThanOrEqual(actionBox.top);
  await expect(dialog.getByRole('switch', { name: 'Create more' })).toBeVisible();
}

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: resolve(SHOT_DIR, `${name}.png`), animations: 'disabled' });
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
}

async function expectCoarsePointerGeometry(dialog: Locator, item: ComposerCase): Promise<void> {
  await dialog.evaluate(async (node) => {
    await Promise.all(
      node.getAnimations({ subtree: true }).map(async (animation) => animation.finished),
    );
  });
  const close = dialog.getByRole('button', { name: 'Close' });
  const expand = dialog.getByRole('button', { name: 'Expand editor' });
  if ((await expand.count()) > 0) {
    await expect(close).toHaveCSS('width', '40px');
    await expect(expand).toHaveCSS('width', '40px');
    const [closeBox, expandBox] = await Promise.all([close.boundingBox(), expand.boundingBox()]);
    expect(closeBox).not.toBeNull();
    expect(expandBox).not.toBeNull();
    if (!closeBox || !expandBox) throw new Error('Composer header controls have no layout box.');
    expect(closeBox.width).toBeGreaterThanOrEqual(40);
    expect(expandBox.width).toBeGreaterThanOrEqual(40);
    expect(expandBox.x + expandBox.width).toBeLessThanOrEqual(closeBox.x);
  }

  if (item.properties === null) return;
  const propertyRow = dialog.getByRole('group', { name: item.properties });
  const inline = propertyRow.locator('[data-entity-metadata-inline]');
  const inlineViewport = inline.locator('..');
  const inlineBox = await inlineViewport.boundingBox();
  expect(inlineBox).not.toBeNull();
  if (!inlineBox) throw new Error('Composer metadata lane has no layout box.');
  for (const control of await inline.getByRole('button').all()) {
    const controlBox = await control.boundingBox();
    if (controlBox !== null) {
      expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(
        inlineBox.x + inlineBox.width + 1,
      );
    }
  }
  const overflow = propertyRow.getByRole('button', { name: `More ${item.properties}` });
  if ((await overflow.count()) > 0) {
    const overflowBox = await overflow.boundingBox();
    expect(overflowBox).not.toBeNull();
    if (!overflowBox) throw new Error('Composer metadata overflow control has no layout box.');
    expect(overflowBox.width).toBeGreaterThanOrEqual(40);
    expect(inlineBox.x + inlineBox.width).toBeLessThanOrEqual(overflowBox.x);
  }
}

test('create composers keep one compact shell and two explicit footer rows', async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const { orgId } = await signUpAndOnboard(page, 'CreateComposers');

  for (const item of COMPOSERS) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setColorScheme(page, 'light');
    const dialog = await openComposer(page, orgId, item);
    await expect(dialog).toHaveCSS('max-width', '672px');
    await expectTwoFooterRows(dialog, item);
    await capture(page, `${item.slug}-desktop-light`);
    await setColorScheme(page, 'dark');
    await capture(page, `${item.slug}-desktop-dark`);

    await page.setViewportSize({ width: 390, height: 844 });
    await setColorScheme(page, 'light');
    await expectTwoFooterRows(dialog, item);
    await expectNoPageOverflow(page);
    await capture(page, `${item.slug}-mobile-light`);
    await setColorScheme(page, 'dark');
    await capture(page, `${item.slug}-mobile-dark`);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
  }

  const initiative = COMPOSERS[2];
  if (!initiative) throw new Error('Initiative composer case is missing.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await setColorScheme(page, 'light');
  const dialog = await openComposer(page, orgId, initiative);
  await dialog.getByRole('button', { name: 'Expand editor' }).click();
  await expect(dialog).toHaveCSS('max-width', '1024px');
  await expectTwoFooterRows(dialog, initiative);
  await capture(page, 'initiative-expanded-desktop-light');
  await setColorScheme(page, 'dark');
  await capture(page, 'initiative-expanded-desktop-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await setColorScheme(page, 'light');
  await expectTwoFooterRows(dialog, initiative);
  await capture(page, 'initiative-expanded-mobile-light');
  await setColorScheme(page, 'dark');
  await capture(page, 'initiative-expanded-mobile-dark');
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.setViewportSize({ width: 320, height: 844 });
  await setColorScheme(page, 'light');
  const task = COMPOSERS[0];
  if (!task) throw new Error('Task composer case is missing.');
  await openComposer(page, orgId, task);
  await expectNoPageOverflow(page);
  await capture(page, 'task-320-light');
});

test.describe('coarse-pointer composer geometry', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('keeps header targets separate and metadata inside its inline lane', async ({ page }) => {
    test.setTimeout(900_000);
    mkdirSync(SHOT_DIR, { recursive: true });
    const { orgId } = await signUpAndOnboard(page, 'CreateComposersTouch');
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);

    for (const item of COMPOSERS) {
      const dialog = await openComposer(page, orgId, item);
      await expectTwoFooterRows(dialog, item);
      await expectCoarsePointerGeometry(dialog, item);
      await expectNoPageOverflow(page);
      await capture(page, `${item.slug}-mobile-touch-light`);
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toHaveCount(0);
    }
  });
});
