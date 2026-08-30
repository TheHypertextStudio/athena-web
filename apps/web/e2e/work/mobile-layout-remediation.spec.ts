/** Rendered high-risk mobile contracts for the shared overlay and shell remediation. */
import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test('mobile overlays own one scroll body and restore their opener focus', async ({ page }) => {
  test.setTimeout(180_000);
  const { orgId } = await signUpAndOnboard(page, 'MobileLayoutRemediation');

  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto(orgHref(orgId, 'tasks'), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await page.waitForTimeout(500);

  const filterTrigger = page.getByRole('button', { name: 'Filter' });
  await filterTrigger.focus();
  await filterTrigger.click();
  const filter = page.getByRole('dialog', { name: 'Filter tasks' });
  await expect(filter.getByRole('searchbox', { name: 'Search filters' })).toBeVisible();
  const filterGeometry = await filter.evaluate((element) => {
    const scrollOwners = element.querySelectorAll('[data-overlay-scroll-owner]');
    const body = scrollOwners.item(0) as HTMLElement | null;
    if (!body) throw new Error('Filter panel has no owned scroll body.');
    return {
      scrollOwners: scrollOwners.length,
      overflowY: getComputedStyle(body).overflowY,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  expect(filterGeometry.scrollOwners).toBe(1);
  expect(filterGeometry.overflowY).toMatch(/auto|scroll/);
  expect(filterGeometry.documentWidth).toBeLessThanOrEqual(filterGeometry.viewportWidth);

  await page.keyboard.press('Escape');
  await expect(filter).toHaveCount(0);
  await expect(filterTrigger).toBeFocused();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/calendar', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  await page.waitForTimeout(500);
  const createTrigger = page.getByRole('button', { name: 'New' });
  await createTrigger.focus();
  await createTrigger.click();
  const create = page.getByRole('dialog', { name: 'Create calendar item' });
  await expect(create.getByRole('button', { name: 'Save' })).toBeVisible();
  const createGeometry = await create.evaluate((element) => {
    const body = element.querySelector<HTMLElement>('[data-overlay-scroll-owner]');
    if (!body) throw new Error('Calendar Create has no owned scroll body.');
    return {
      scrollOwners: element.querySelectorAll('[data-overlay-scroll-owner]').length,
      radius: getComputedStyle(element).borderTopLeftRadius,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  expect(createGeometry.scrollOwners).toBe(1);
  expect(createGeometry.radius).not.toBe('0px');
  expect(createGeometry.documentWidth).toBeLessThanOrEqual(createGeometry.viewportWidth);

  await page.keyboard.press('Escape');
  await expect(create).toHaveCount(0);
  await expect(createTrigger).toBeFocused();
});
