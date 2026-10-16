/** Public link metadata is available before JavaScript, and denied briefs reveal no work. */
import { problemDefinition } from '../../src/lib/contracts/errors';
import { expect, test } from '../helpers/fixtures';

test.use({ javaScriptEnabled: false });

test('public problem guidance includes its title and description in the initial head', async ({
  page,
}) => {
  const definition = problemDefinition('forbidden');
  if (!definition) throw new Error('The public forbidden problem definition must exist.');
  const response = await page.goto('/problems/forbidden', { waitUntil: 'domcontentloaded' });
  if (!response) throw new Error('The public problem page must return a document.');
  expect(response.status()).toBe(200);
  const html = await response.text();
  const head = html.slice(0, html.indexOf('</head>'));
  expect(head).toContain('<title>');
  await expect(page).toHaveTitle(`${definition.title} — Docket`);
  expect(head).toContain('name="description"');
  await expect(page.locator('head meta[name="description"]')).toHaveAttribute(
    'content',
    definition.summary,
  );
  await expect(page.getByRole('heading', { name: definition.title, exact: true })).toBeVisible();
});

test('unavailable public briefs stay private in both route shapes without JavaScript', async ({
  page,
}) => {
  for (const route of [
    '/briefs/metadata-unavailable-workspace/metadata-unavailable-brief',
    '/briefs/domain/metadata-unavailable-brief',
  ]) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    if (!response) throw new Error('The public brief must return a document.');
    expect(response.status()).toBe(404);
    await expect(page.locator('head meta[property="og:type"][content="article"]')).toHaveCount(0);
    await expect(page.locator('head meta[property="og:title"]')).toHaveCount(0);
    await expect(page.locator('head link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('article')).toHaveCount(0);
  }
});
