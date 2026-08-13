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
  const peopleNeedingDecision = page.locator('section[aria-label="People who need a decision"]');
  const decisions = peopleNeedingDecision.getByRole('listitem');
  await expect(decisions).toHaveCount(3);

  const dana = decisions.filter({ hasText: 'Dana Whitfield' });
  await dana.getByRole('button', { name: 'Apply' }).click();
  await expect(dana).toHaveCount(0, { timeout: TIMEOUTS.ui });
  await expect(decisions).toHaveCount(2, { timeout: TIMEOUTS.ui });

  // "Don't sync them" is a decision like any other, and has to stick like one. This is the exact
  // path that used to refresh the list and put the person straight back: the skip wrote a state
  // indistinguishable from never having decided, so the count never fell.
  const sam = decisions.filter({ hasText: 'Sam Ortega' });
  const samDecision = sam.getByRole('combobox', {
    name: 'What should Docket do about Sam Ortega?',
  });
  await samDecision.selectOption('skip');
  await expect(samDecision).toHaveValue('skip');
  await sam.getByRole('button', { name: 'Apply' }).click();
  await expect(sam).toHaveCount(0, { timeout: TIMEOUTS.ui });
  await expect(decisions).toHaveCount(1, { timeout: TIMEOUTS.ui });

  // They are not gone, just decided — and the decision can be taken back.
  const ignored = page.locator('details').filter({ hasText: '1 person you’re not syncing' });
  await ignored.locator('summary').click();
  const undo = ignored.getByRole('button', { name: 'Sort out' });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(decisions).toHaveCount(2, { timeout: TIMEOUTS.ui });

  // Back on the hub, the mirror can actually be run. Before this there was no affordance at all
  // once the databases existed, which is what left a stalled sync with no way forward.
  await page.goBack();
  const syncNow = page.getByRole('button', { name: 'Sync now' });
  await expect(syncNow).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await syncNow.click();
  await expect(syncNow).toBeEnabled({ timeout: TIMEOUTS.sweep });
  await expect(page.getByRole('alert')).toHaveCount(0);
});
