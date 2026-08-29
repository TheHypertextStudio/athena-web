import { orgHref, TIMEOUTS } from '../helpers/constants';
import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

test.use({ viewport: { width: 390, height: 600 } });

test('work view overlays keep their controls reachable on a short phone viewport', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const { orgId } = await signUpAndOnboard(page, 'WorkViewOverlayGeometry');
  await page.goto(orgHref(orgId, 'tasks'), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });

  await page.getByRole('button', { name: 'Filter' }).click();
  const filter = page.getByRole('dialog', { name: 'Filter tasks' });
  const filterSearch = filter.getByRole('searchbox', { name: 'Search filters' });
  const advanced = filter.getByRole('button', { name: 'Advanced filter' });
  const filterBody = filter.locator('[data-overlay-scroll-owner]');

  await expect(filterSearch).toBeVisible();
  await expect(advanced).toBeVisible();
  await expect(filterBody).toHaveCount(1);
  const filterGeometry = await filter.evaluate((element) => {
    const body = element.querySelector<HTMLElement>('[data-overlay-scroll-owner]');
    if (!body) throw new Error('Filter panel has no scroll body.');
    const panel = element.getBoundingClientRect();
    const search = element
      .querySelector<HTMLElement>('[role="searchbox"]')
      ?.getBoundingClientRect();
    const terminal = [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent.trim() === 'Advanced filter')
      ?.getBoundingClientRect();
    return {
      panel,
      search,
      terminal,
      overflowY: getComputedStyle(body).overflowY,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
    };
  });
  expect(filterGeometry.search?.top).toBeGreaterThanOrEqual(filterGeometry.panel.top);
  expect(filterGeometry.terminal?.bottom).toBeLessThanOrEqual(filterGeometry.panel.bottom);
  expect(filterGeometry.overflowY).toMatch(/auto|scroll/);

  await filter.getByRole('button', { name: 'Advanced filter' }).click();
  await expect(filter.getByRole('button', { name: 'Apply filter' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Display' }).click();
  const display = page.getByRole('dialog', { name: 'Display view' });
  await expect(display.getByRole('button', { name: 'Find in this view' })).toBeVisible();
  await expect(display.getByRole('radio', { name: 'List' })).toBeVisible();
  await expect(display.getByRole('button', { name: 'Organize' })).toBeVisible();

  await display.getByRole('button', { name: 'Organize' }).click();
  await expect(display.getByRole('heading', { name: 'Organize' })).toBeVisible();
  await expect(display.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(display.getByRole('heading', { name: 'Properties' })).toHaveCount(0);

  await display.getByRole('button', { name: 'Back' }).click();
  await display.getByRole('button', { name: 'Properties' }).click();
  await expect(display.getByRole('heading', { name: 'Properties' })).toBeVisible();
  await expect(display.getByRole('heading', { name: 'Organize' })).toHaveCount(0);

  const displayGeometry = await display.evaluate((element) => {
    const panel = element.getBoundingClientRect();
    const body = element.querySelector<HTMLElement>('[data-overlay-scroll-owner]');
    if (!body) throw new Error('Display panel has no scroll body.');
    return { panel, overflowY: getComputedStyle(body).overflowY };
  });
  expect(displayGeometry.panel.height).toBeLessThanOrEqual(576);
  expect(displayGeometry.overflowY).toMatch(/auto|scroll/);
});
