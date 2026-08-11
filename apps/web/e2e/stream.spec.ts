/** Functional journey for Stream's context-wide, subject-led timeline. */
import { signUpAndOnboard } from './helpers/app';
import { orgHref, TIMEOUTS } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { seedStreamTimeline } from './helpers/stream';

test('keeps substantive changes explicit inside a compact context episode', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  const { orgId } = await signUpAndOnboard(page, 'StreamTimeline');
  await seedStreamTimeline(page, orgId);

  await page.goto(orgHref(orgId, 'stream'), { waitUntil: 'domcontentloaded' });
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Stream' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  runtimeErrors.length = 0;
  await expect(main.getByText(/Everything that happened in/)).toBeVisible();
  await expect(main.getByRole('button', { name: 'Display' })).toHaveCount(0);

  const episode = main.getByRole('article').filter({ hasText: 'Ship the beta' });
  await expect(episode).toBeVisible({ timeout: TIMEOUTS.sweep });
  await expect(episode.getByText('Ship the beta')).toHaveCount(1);
  await expect(episode.getByText('You completed the task')).toBeVisible();
  await expect(episode.getByText(/Priority: .* → Urgent/)).toBeVisible();
  await expect(episode.getByText(/Due date: .* → Aug 19, 2026/)).toBeVisible();
  await expect(episode.getByText('Willie Chalmers III')).toHaveCount(0);
  await expect(episode.getByText('Docket')).toHaveCount(0);

  const disclosure = episode.getByRole('button', { name: /Show \d+ related events?/ });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  const related = episode.getByRole('list', { name: 'Related activity' });
  await expect(related.getByText('You updated details')).toHaveCount(2);
  await expect(related.getByText(/Description:/)).toHaveCount(2);

  await episode.getByText('You completed the task').click();
  const drawer = page.getByRole('dialog', { name: 'Event details' });
  await expect(drawer.getByText(/You completed/)).toBeVisible();
  await expect(drawer.getByText(/In progress → Done/)).toBeVisible();
  await expect(drawer.getByText(/\d{1,2}:\d{2}/)).toBeVisible();
  await drawer.getByRole('button', { name: 'Close event details' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(main.getByRole('heading', { name: 'Stream' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Filters' })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.setViewportSize({ width: 320, height: 844 });
  const filters = main.getByRole('button', { name: 'Filters' });
  await expect(filters).toBeVisible();
  const filterBounds = await filters.boundingBox();
  expect(filterBounds?.height).toBeGreaterThanOrEqual(40);
  await page.keyboard.press('Tab');
  await filters.focus();
  await expect(filters).toBeFocused();
  const hasVisibleFocus = await filters.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
  });
  expect(hasVisibleFocus).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Filter where', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const hasNarrowHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasNarrowHorizontalOverflow).toBe(false);
  expect(runtimeErrors).toEqual([]);
});
