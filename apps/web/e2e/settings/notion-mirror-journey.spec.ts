/**
 * The Notion mirror, driven the way a person reaches it: entirely through the UI.
 *
 * @remarks
 * The other specs call the API directly, which meant the surface could be — and for a while was —
 * completely unreachable while every test still passed. This one clicks: Connections → the Notion
 * card's link → pick a page → Create in Notion → see real row counts. If any link in that chain is
 * missing, this fails.
 */
import { signUpAndOnboard } from '../helpers/app';
import { apiFetch } from '../helpers/net';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test('a person can reach Notion from Connections and create the databases', async ({ page }) => {
  const { orgId } = await signUpAndOnboard(page, 'NotionJourney');

  // Connecting itself is an OAuth ceremony, so it is the one step done out of band.
  const created = await apiFetch(page, `/v1/orgs/${orgId}/integrations`, {
    method: 'POST',
    body: { provider: 'notion', pattern: 'connector' },
  });
  expect(created.ok).toBe(true);

  // From here on, only clicks.
  await page.goto(orgHref(orgId, 'settings/connections'), { waitUntil: 'domcontentloaded' });
  const notionCard = page.locator('li').filter({ hasText: 'Notion' }).first();
  await expect(notionCard).toBeVisible({ timeout: TIMEOUTS.pageReady });

  // The card must offer a way in. Without this link the page below is URL-only.
  await notionCard.getByRole('link', { name: /Manage|Set up/ }).click();
  await expect(page.getByRole('heading', { name: 'Docket in Notion' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  // The setup card is the affordance the hub's own copy promises.
  await expect(page.getByText('Create these in Notion')).toBeVisible();
  await page.getByRole('button', { name: 'Create in Notion' }).click();

  await expect(page.getByText(/rows in 9 databases/)).toBeVisible({ timeout: TIMEOUTS.sweep });

  // And the people surface is reachable rather than landing on a not-found.
  await page.goto(orgHref(orgId, 'settings/connections/notion/people'), {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByText(/have no Notion account/)).toBeVisible();
});
