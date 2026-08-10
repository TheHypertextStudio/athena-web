/**
 * Connections — and everything nested under it, including the Notion mirror — is reachable
 * from the Settings sidebar for a real team workspace.
 *
 * @remarks
 * Two confirmed, independent bugs made this impossible before this spec existed:
 *
 * 1. `/orgs/:orgId/settings/connections` had no row in either org-scoped nav registry
 *    (`sections.ts` / `sections-personal.ts`) — a live route reachable only by typing the URL.
 * 2. `next.config.ts` unconditionally redirected `/orgs/:orgId/settings/connections` (and its
 *    `google-calendar` child) to the CALLER's personal `/settings/connections` — discarding
 *    `:orgId` for every org, including real team workspaces. A team member clicking through never
 *    saw their team's connections; they silently saw their own personal ones instead.
 *
 * Deliberately built on a real TEAM org (`isPersonal: false`), not `signUpAndOnboard`'s personal
 * space: a personal org already reaches Connections through the separate global `/settings/*`
 * nav, so testing against it would never have caught either bug.
 *
 * Assertions navigate with `page.goto` between steps rather than clicking through every hop. A
 * SEPARATE, pre-existing, unrelated bug was found while writing this spec: a client-side `<Link>`
 * transition between sibling settings sections drops the shared layout's `<h1>Settings</h1>` and
 * its own section nav (reproduces on the untouched "General" section too, so it predates and is
 * independent of this change) — the destination page's own content still renders correctly, and a
 * reload restores the chrome. That is a real papercut, filed separately rather than fixed here or
 * quietly avoided by this spec.
 */
import { signUpAndOnboard } from '../helpers/app';
import { apiFetch } from '../helpers/net';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test('Connections has a nav row and reaches the real team workspace, not the caller’s personal one', async ({
  page,
}) => {
  await signUpAndOnboard(page, 'NotionNav');
  const created = await apiFetch(page, '/v1/orgs', {
    method: 'POST',
    body: { name: 'NotionNav Team' },
  });
  if (!created.ok) throw new Error(`create team org ${String(created.status)}`);
  const orgId = (created.body as { organization: { id: string } }).organization.id;

  await apiFetch(page, `/v1/orgs/${orgId}/integrations`, {
    method: 'POST',
    body: { provider: 'notion', pattern: 'connector' },
  });

  // 1. The sidebar shows it. This is the direct fix for "where does this even belong" — Connections
  // was previously absent from the team-workspace registry entirely.
  await page.goto(orgHref(orgId, 'settings/general'), { waitUntil: 'domcontentloaded' });
  const connectionsLink = page
    .getByRole('navigation', { name: 'Settings sections' })
    .locator(`a[href="/orgs/${orgId}/settings/connections"]`);
  await expect(connectionsLink).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await expect(connectionsLink).toHaveAccessibleName('Connections');
  await expect(connectionsLink).toHaveAttribute('href', `/orgs/${orgId}/settings/connections`);

  // 2. It reaches the TEAM's own connections, not the redirect's old destination (the caller's
  // personal workspace). The sidebar's own workspace switcher confirms which workspace rendered.
  await page.goto(orgHref(orgId, 'settings/connections'), { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/settings/connections$`));
  await expect(page.getByRole('button', { name: /NotionNav Team/ })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByText(/This workspace/)).toBeVisible();

  // 3. Notion, reached from that page, one hop deeper.
  const notionCard = page.locator('li').filter({ hasText: 'Notion' }).first();
  await notionCard.getByRole('link', { name: /Manage|Set up/ }).click();
  await expect(page.getByRole('heading', { name: 'Notion', exact: true })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('link', { name: 'Back to Connections' })).toBeVisible();

  // 4. And People, one hop deeper still — the whole chain has a way back at every level.
  await page.goto(orgHref(orgId, 'settings/connections/notion/people'), {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('link', { name: 'Back to Notion' })).toBeVisible();
});
