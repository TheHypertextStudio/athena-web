/** First-use clarity, narrow editing, and accessibility of the daily planning workspace. */
import axe, { type AxeStatic } from 'axe-core';
import { expect, test } from '../helpers/fixtures';
import { openPlan, setupPlan, showPlanningPanel } from '../helpers/daily-planning';

const titles = ['Prepare the meeting brief', 'Review survey findings', 'Send the committee agenda'];

test.describe('compact daily planning', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('keeps three chosen tasks editable above discovery without showing them twice', async ({
    page,
  }) => {
    const context = await setupPlan(page, 'planning-design-density', titles, 1);
    await openPlan(page, context.date);
    await showPlanningPanel(page, 'Work');
    const selected = page.getByRole('region', { name: 'Selected work', exact: true });
    await expect(selected).toBeVisible();
    expect((await selected.boundingBox())?.height).toBeLessThan(300);
    const browser = page.getByRole('region', { name: 'Existing tasks', exact: true });
    await expect(browser.getByText(titles[0] ?? '', { exact: true })).toHaveCount(0);
    const time = selected.getByRole('spinbutton', { name: `Planned time for ${titles[0]}` });
    expect((await time.boundingBox())?.height).toBeGreaterThanOrEqual(40);
    await time.fill('60');
    await time.press('Tab');
    await expect(time).toHaveValue('60');
    await browser.getByRole('searchbox').fill(titles[0] ?? '');
    await expect(browser.getByText('In plan', { exact: true })).toBeVisible();
    await expect(
      browser.getByRole('button', { name: `Add ${titles[0]}`, exact: true }),
    ).toHaveCount(0);
  });

  test('names the active scope after closing filters and clears it without reopening them', async ({
    page,
  }) => {
    const context = await setupPlan(page, 'planning-design-filter', [], 1);
    await openPlan(page, context.date);
    await showPlanningPanel(page, 'Work');
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Task filters', exact: true });
    await expect(panel).toBeVisible();
    const scope = panel.getByRole('combobox', { name: 'Task scope', exact: true });
    await scope.selectOption('created');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    const active = page.getByRole('group', { name: 'Active task filters' });
    await expect(active).toHaveText(/Created by me/);
    await active.getByRole('button', { name: 'Clear task filters' }).click();
    await expect(active).toHaveCount(0);
  });
});

test('shows work hours in the Agenda and changes the visible timeline window', async ({ page }) => {
  const context = await setupPlan(page, 'planning-design-workday', titles, 1);
  await openPlan(page, context.date);
  const agenda = page.getByRole('region', { name: 'Planned agenda', exact: true });
  const hours = agenda.getByRole('button', { name: 'Workday hours', exact: true });
  await expect(hours).toBeVisible();
  const window = page.locator('[data-workday-window]');
  await expect(window).toBeVisible();
  const previousHeight = await window.evaluate((element) => element.getBoundingClientRect().height);
  await hours.click();
  const workday = page.getByRole('dialog', { name: 'Workday', exact: true });
  await workday.getByLabel('Ends').fill('18:00');
  await expect(hours).toContainText('6:00 PM');
  await expect
    .poll(() => window.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(previousHeight);
});

test('supports long task names, text scaling and AA checks in both themes at 320px', async ({
  page,
}) => {
  const longTitle =
    'Prepare the community meeting brief with survey findings and recommendations for the committee';
  const context = await setupPlan(page, 'planning-design-accessibility', [longTitle], 1);
  await page.setViewportSize({ width: 320, height: 844 });
  await openPlan(page, context.date);
  await showPlanningPanel(page, 'Work');
  await page.addScriptTag({ content: axe.source });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const violations = await page.evaluate(async () => {
      const checker = (window as unknown as { axe: AxeStatic }).axe;
      return (
        await checker.run('main', {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
        })
      ).violations;
    });
    expect(violations).toEqual([]);
  }
  const title = page.getByRole('textbox', { name: `Task title: ${longTitle}` });
  await title.focus();
  await expect(title).toBeFocused();
  expect(await title.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(
    page.getByRole('button', { name: 'Review plan', exact: true }).last(),
  ).toBeInViewport();
});

test('keeps rename recovery and the edited title reachable at 320px', async ({ page }) => {
  const context = await setupPlan(
    page,
    'planning-design-recovery',
    ['Prepare the meeting brief'],
    1,
  );
  await page.setViewportSize({ width: 320, height: 844 });
  await openPlan(page, context.date);
  await showPlanningPanel(page, 'Work');
  await page.route(`**/tasks/${context.taskIds[0]}`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      : route.continue(),
  );
  const title = page.getByRole('textbox', { name: 'Task title: Prepare the meeting brief' });
  await title.fill('Prepare a revised meeting brief');
  await title.press('Enter');
  const retry = page.getByRole('button', { name: 'Retry rename' });
  await expect(retry).toBeVisible();
  const bounds = await retry.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
  await expect(
    page.getByRole('textbox', { name: 'Task title: Prepare a revised meeting brief' }),
  ).toHaveValue('Prepare a revised meeting brief');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
