/** Sustained planning owns its navigation level and exposes one selected lens. */
import { expect, test } from '../helpers/fixtures';
import { blueprintWorkspace } from '../helpers/work-template-blueprints';
import { TIMEOUTS } from '../helpers/constants';

const session = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (session) test.use({ storageState: session });

test('weekly planning replaces workspace navigation and returns deliberately to Today', async ({
  page,
}) => {
  await blueprintWorkspace(page);
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto('/plan', { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
  await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'The week', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Start of day', exact: true }).click();
  await expect(page.getByRole('button', { name: 'The week', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Start of day', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Back to Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
});
