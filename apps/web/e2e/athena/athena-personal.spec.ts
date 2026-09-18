import type { Locator, Page, Route } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

/**
 * Press the Athena shortcut until the panel it reveals is on screen.
 *
 * @remarks
 * The shortcut is bound on hydration, so a single press right after a navigation can land before
 * anything is listening. The handler reveals rather than toggles, so pressing again is harmless.
 */
async function openAthenaPanel(page: Page, panel: Locator): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Meta+J');
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

const createdAt = '2026-07-15T15:00:00.000Z';

/** An empty, settled conversation — what `GET /v1/orgs/:orgId/sessions/chat` answers with. */
const emptyThread = {
  id: 'athena_fixture_thread',
  kind: 'chat',
  status: 'completed',
  objective: 'Chat',
  startedAt: createdAt,
  endedAt: createdAt,
  createdAt,
  activities: [],
  result: null,
} as const;

/** Install the personal Athena API fixture used to exercise rail and full-page entry points. */
async function installAthenaFixture(page: Page, orgId: string): Promise<void> {
  const session = {
    id: 'athena_fixture_session',
    kind: 'job',
    status: 'awaiting_approval',
    queueState: 'needs_you',
    objective: 'Protect two hours for the launch review',
    context: {
      workspaceId: orgId,
      source: { type: 'project', id: 'project_fixture', label: 'Athena launch' },
    },
    workspace: { id: orgId, name: 'Personal workspace' },
    startedAt: createdAt,
    endedAt: null,
    createdAt,
  } as const;
  const detail = { ...session, activities: [], result: null } as const;

  await page.route('**/v1/me/athena**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown): Promise<void> =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() === 'GET' && path === '/v1/me/athena/pulse') {
      await json({ needsYou: 1, working: 0 });
      return;
    }
    // The rail sends through the personal door; the thread is re-read through the org one below.
    if (request.method() === 'POST' && path === '/v1/me/athena/chat/messages') {
      await json(emptyThread);
      return;
    }
    if (request.method() === 'GET' && path === '/v1/me/athena') {
      await json({
        counts: { needsYou: 1, working: 0, finished: 0 },
        currentChat: null,
        sessions: { needsYou: [session], working: [], finished: [] },
      });
      return;
    }
    if (request.method() === 'GET' && path === `/v1/me/athena/sessions/${session.id}`) {
      await json(detail);
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/v1/orgs/*/sessions/chat', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyThread),
    });
  });
}

test('Athena uses the utility rail on normal pages and its full workspace on Calendar', async ({
  page,
}, testInfo) => {
  const { orgId } = await signUpAndOnboard(page, 'personal-athena');
  await installAthenaFixture(page, orgId);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/today');
  await expect(page.getByRole('button', { name: 'Open Athena', exact: true })).toHaveCount(0);

  const desktopRail = page.getByRole('complementary', { name: 'Athena' });
  await openAthenaPanel(page, desktopRail);
  // The rail is the conversation itself now: a composer to write in, and the way to the wide view.
  await expect(desktopRail.getByRole('form', { name: /Message Athena/ })).toBeVisible();
  await expect(desktopRail.getByRole('link', { name: /Open the Athena page/ })).toBeVisible();
  await expect(desktopRail.getByRole('list', { name: /Suggestions/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('athena-rail-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileRail = page.getByRole('dialog', { name: 'Athena' });
  await openAthenaPanel(page, mobileRail);
  await expect(mobileRail.getByRole('form', { name: /Message Athena/ })).toBeVisible();
  await expect(mobileRail.getByRole('button', { name: 'Open Athena', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('athena-rail-mobile.png'), fullPage: true });

  await page.goto('/calendar');
  await expect(page.getByRole('complementary', { name: 'Athena' })).toHaveCount(0);
  await expect(async () => {
    await page.keyboard.press('Meta+J');
    await expect(page).toHaveURL(/\/athena\?workspace=/, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Your Athena work' })).toBeVisible();
});
