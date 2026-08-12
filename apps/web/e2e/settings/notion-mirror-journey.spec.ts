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
  const integrationId = (created.body as { id: string }).id;
  const verified = await apiFetch(page, `/v1/orgs/${orgId}/integrations/${integrationId}/verify`, {
    method: 'POST',
  });
  expect(verified.ok).toBe(true);
  expect((verified.body as { status?: string }).status).toBe('connected');

  // From here on, only clicks.
  await page.goto(orgHref(orgId, 'settings/connections'), { waitUntil: 'domcontentloaded' });
  const notionCard = page.locator('li').filter({ hasText: 'Notion' }).first();
  await expect(notionCard).toBeVisible({ timeout: TIMEOUTS.pageReady });

  // The card must offer a way in. Without this link the page below is URL-only.
  await notionCard.getByRole('link', { name: 'Manage' }).click();
  await expect(page.getByText('Set up Docket in Notion')).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  // Nothing is preselected, so the button cannot fire until a page has genuinely been chosen.
  const create = page.getByRole('button', { name: 'Create in Notion' });
  await expect(create).toBeDisabled();

  await page.getByRole('button', { name: /Notion page/ }).click();
  await page.getByRole('option', { name: /Team wiki/ }).click();
  await expect(create).toBeEnabled();
  await create.click();

  await expect(page.getByText('Set up Docket in Notion')).toBeHidden({ timeout: TIMEOUTS.sweep });

  // Afterwards the page answers the two questions it used to leave open: where the databases went,
  // and how to reach one.
  await expect(page.getByRole('heading', { name: 'Tables Docket builds for you' })).toBeVisible();
  await expect(page.getByText('Where this lives')).toBeVisible();
  await expect(page.getByRole('link', { name: /Team wiki/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open in Notion/ })).toHaveCount(9);

  // Every table offers a way to configure it. This is the assertion that would have caught a hub
  // whose only affordance was a name styled as body text.
  await expect(page.getByRole('link', { name: 'Configure' })).toHaveCount(9);

  // And the people surface is reachable rather than landing on a not-found.
  await page.getByRole('link', { name: 'Match people' }).click();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByText(/have no Notion account/)).toBeVisible();
  // An unmatched person can actually be RESOLVED, not merely counted. The mock workspace has
  // three; resolving one must leave two, which is what proves the decision was applied rather
  // than the list simply re-rendering.
  const decisions = page.getByRole('button', { name: 'Apply' });
  await expect(decisions).toHaveCount(3);
  await decisions.first().click();
  await expect(decisions).toHaveCount(2, { timeout: TIMEOUTS.ui });
});
