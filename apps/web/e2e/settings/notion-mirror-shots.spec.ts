/**
 * Visual capture for the Notion mirror surfaces, in every state they can be in.
 *
 * @remarks
 * The states differ by *data*, not by route: whether Notion is connected at all, whether the
 * designed databases have been created yet, whether the workspace has rows to preview, and
 * whether a column editor is open. None of that is reachable by visiting a URL, so this spec
 * drives each one and attaches the result.
 *
 * Assertions are deliberately thin — a broken flow should fail a functional spec, while these
 * exist for a human looking at the output. The one thing they do assert is that the surface
 * rendered at all, so a blank screenshot cannot pass as evidence.
 */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { apiFetch, apiJson } from '../helpers/net';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

/**
 * Where the captures land.
 *
 * @remarks
 * Written to the design-audit archive rather than only attached to the Playwright report, so the
 * evidence survives the run and can be reviewed (and diffed) alongside every previous audit.
 */
const SHOT_DIR = new URL(
  '../../../../docs/design/audits/screenshots/2026-08-08-notion-mirror/',
  import.meta.url,
).pathname;

/** Capture the full page to the audit archive. */
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}${name}`, fullPage: true });
}

/** The two viewports the rest of the suite captures at. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

/** Create a Notion connection so the connected states render. */
async function connectNotion(page: Page, orgId: string): Promise<string> {
  const res = await apiFetch(page, `/v1/orgs/${orgId}/integrations`, {
    method: 'POST',
    body: { provider: 'notion', pattern: 'connector' },
  });
  if (!res.ok) throw new Error(`connect notion ${res.status}: ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

/** Give the workspace a few real rows, so the designer preview is not the sample state. */
async function seedWork(page: Page, orgId: string): Promise<void> {
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  if (teamId === undefined) return;
  for (const title of [
    'Fix the Route 66 timetable',
    'Draft the outreach RFP',
    'Survey weekday riders',
  ]) {
    await apiJson(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title, teamId },
    });
  }
}

test.describe('notion mirror visuals', () => {
  for (const viewport of VIEWPORTS) {
    test(`hub and designer (${viewport.name})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const { orgId } = await signUpAndOnboard(page, `NotionShot${viewport.name}`);
      const notionHref = orgHref(orgId, 'settings/connections/notion');

      // 1. Not connected — the empty state that explains what connecting would get you.
      await page.goto(notionHref, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Notion isn’t connected yet')).toBeVisible({
        timeout: TIMEOUTS.pageReady,
      });
      await shot(page, `notion-disconnected-${viewport.name}-light.png`);
      await setColorScheme(page, 'dark');
      await shot(page, `notion-disconnected-${viewport.name}-dark.png`);
      await setColorScheme(page, 'light');

      await seedWork(page, orgId);

      // 2. Connected, designed, nothing created in Notion yet — the state right after connecting.
      await connectNotion(page, orgId);
      await page.goto(notionHref, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Set up Docket in Notion')).toBeVisible({
        timeout: TIMEOUTS.pageReady,
      });
      await shot(page, `notion-hub-${viewport.name}-light.png`);
      await setColorScheme(page, 'dark');
      await shot(page, `notion-hub-${viewport.name}-dark.png`);
      await setColorScheme(page, 'light');

      // 3. The designer with SAMPLE rows — a workspace with none of this entity yet.
      await page.goto(orgHref(orgId, 'settings/connections/notion/initiative'), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByText(/Sample rows/)).toBeVisible({ timeout: TIMEOUTS.pageReady });
      await shot(page, `notion-designer-sample-${viewport.name}-light.png`);

      // 4. The designer with REAL rows — the state the surface exists for.
      await page.goto(orgHref(orgId, 'settings/connections/notion/task'), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByText(/Previewing/)).toBeVisible({ timeout: TIMEOUTS.pageReady });
      await shot(page, `notion-designer-real-${viewport.name}-light.png`);
      await setColorScheme(page, 'dark');
      await shot(page, `notion-designer-real-${viewport.name}-dark.png`);
      await setColorScheme(page, 'light');

      // 5. A person column's editor open — the four representations, which is the decision this
      //    whole feature turns on.
      await page.getByRole('button', { name: /task\.assignee/ }).click();
      await expect(page.getByText('Plain text')).toBeVisible({ timeout: TIMEOUTS.ui });
      await shot(page, `notion-column-editor-${viewport.name}-light.png`);
      await setColorScheme(page, 'dark');
      await shot(page, `notion-column-editor-${viewport.name}-dark.png`);
      await setColorScheme(page, 'light');

      // 6. The People designer — where the native-account column and the account-less roster
      //    sit side by side.
      await page.goto(orgHref(orgId, 'settings/connections/notion/person'), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByText(/Previewing|Sample rows/)).toBeVisible({
        timeout: TIMEOUTS.pageReady,
      });
      await shot(page, `notion-designer-people-${viewport.name}-light.png`);
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`provisioned hub (${viewport.name})`, async ({ page }) => {
      // Deliberately a separate test with its own page. Provisioning here happens through the API
      // rather than the UI, so a page that had already rendered the unprovisioned hub would keep
      // serving that from the service worker's cache — an artifact of driving the app out of
      // band, not something a user hits, since the real action invalidates through `useApiMutation`.
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const { orgId } = await signUpAndOnboard(page, `NotionProv${viewport.name}`);
      await connectNotion(page, orgId);
      await seedWork(page, orgId);

      // The setup card: the affordance that turns a design into real databases. Captured before
      // provisioning, because it only exists in that state.
      await page.goto(orgHref(orgId, 'settings/connections/notion'), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByText('Set up Docket in Notion')).toBeVisible({
        timeout: TIMEOUTS.pageReady,
      });
      await shot(page, `notion-setup-${viewport.name}-light.png`);
      await setColorScheme(page, 'dark');
      await shot(page, `notion-setup-${viewport.name}-dark.png`);
      await setColorScheme(page, 'light');

      // Provision by CLICKING, not by POSTing. Driving it out of band leaves the already-loaded
      // page serving the unprovisioned response from the service worker's cache; the real button
      // goes through `useApiMutation` and invalidates, which is also what a user does.
      // Choosing the page is part of the shot, and part of the flow: nothing is preselected, so
      // the button is inert until a real choice has been made.
      await page.getByRole('button', { name: /Notion page/ }).click();
      await shot(page, `notion-page-picker-${viewport.name}-light.png`);
      await page.getByRole('option', { name: /Team wiki/ }).click();
      await page.getByRole('button', { name: 'Create in Notion' }).click();
      // The setup card disappearing is the honest signal that provisioning landed — the hub no
      // longer reports row counts, because a reader does not care that Projects has four rows.
      await expect(page.getByText('Set up Docket in Notion')).toBeHidden({
        timeout: TIMEOUTS.sweep,
      });
      await expect(page.getByText('Where this lives')).toBeVisible({ timeout: TIMEOUTS.ui });
      await expect(page.getByText(/Last updated/)).toBeVisible({ timeout: TIMEOUTS.ui });
      await shot(page, `notion-hub-provisioned-${viewport.name}-light.png`);
      await setColorScheme(page, 'dark');
      await shot(page, `notion-hub-provisioned-${viewport.name}-dark.png`);
      await setColorScheme(page, 'light');

      // People: the surface "Match people" actually leads to now.
      await page.goto(orgHref(orgId, 'settings/connections/notion/people'), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByText(/have no Notion account/)).toBeVisible({
        timeout: TIMEOUTS.pageReady,
      });
      await shot(page, `notion-people-${viewport.name}-light.png`);
      await setColorScheme(page, 'dark');
      await shot(page, `notion-people-${viewport.name}-dark.png`);
      await setColorScheme(page, 'light');
    });
  }

  test('connections page, after the copy and layout fixes', async ({ page }) => {
    // The Linear Agent card broke one word per line here at 390px, and the intro claimed the
    // external tool was the source of truth. Both are captured at the width that showed them.
    await page.setViewportSize({ width: 390, height: 844 });
    const { orgId } = await signUpAndOnboard(page, 'NotionConnShot');
    await page.goto(orgHref(orgId, 'settings/connections'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Keep Docket and the tools you already work in step/)).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await shot(page, 'connections-390-light.png');
    await setColorScheme(page, 'dark');
    await shot(page, 'connections-390-dark.png');
  });
});
