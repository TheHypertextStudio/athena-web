import type { Locator, Page, Route } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { apiFetch } from '../helpers/net';

/**
 * Press the Athena shortcut until the rail it reveals is on screen.
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

const createdAt = '2026-09-13T09:00:00.000Z';

/** The name of the seeded project whose page the rail has to name in its chip. */
const PROJECT_NAME = 'Fall fundraiser launch';

/** An empty, settled conversation — what `GET /v1/orgs/:orgId/sessions/chat` answers with. */
const emptyThread = {
  id: 'athena_companion_thread',
  kind: 'chat',
  status: 'completed',
  objective: 'Chat',
  startedAt: createdAt,
  endedAt: createdAt,
  createdAt,
  activities: [],
  result: null,
} as const;

/** Serve the pulse and an empty conversation so the rail opens on a composer the person can type in. */
async function installAthenaFixture(page: Page): Promise<void> {
  await page.route('**/v1/me/athena**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown): Promise<void> =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() === 'GET' && path === '/v1/me/athena/pulse') {
      await json({ needsYou: 1, working: 0 });
      return;
    }
    if (request.method() === 'POST' && path === '/v1/me/athena/chat/messages') {
      await json(emptyThread);
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

/** Create the project whose page the rail should attach, and return its id. */
async function seedProject(page: Page, orgId: string): Promise<string> {
  const created = await apiFetch(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name: PROJECT_NAME, description: 'The seeded page Athena should name in its chip.' },
  });
  expect(created.status, 'the project seed should create').toBe(201);
  return (created.body as { id: string }).id;
}

test('the Athena panel keeps a half-written message and follows the page the person is on', async ({
  page,
}) => {
  const { orgId } = await signUpAndOnboard(page, 'athena-companion');
  const projectId = await seedProject(page, orgId);
  await installAthenaFixture(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/today');
  const rail = page.getByRole('complementary', { name: 'Athena' });
  await openAthenaPanel(page, rail);
  const composer = rail.getByRole('combobox', { name: /Message Athena/ });
  await expect(composer).toBeVisible();

  const draft = 'Where did the sponsor replies land';
  await composer.click();
  await composer.fill(draft);
  await expect(composer).toHaveValue(draft);

  // Client-side navigation through the sidebar; a full page load would be a different test.
  await page.getByRole('navigation', { name: 'Home' }).getByRole('link', { name: /Inbox/ }).click();
  await expect(page).toHaveURL(/\/inbox/);

  // The rail is a companion, not a page: moving between pages must not throw the draft away.
  await expect(composer).toHaveValue(draft);

  // The page under the panel changes; the chip follows it.
  await page.goto(`/orgs/${orgId}/projects/${projectId}`);
  await expect(page.getByRole('heading', { name: PROJECT_NAME })).toBeVisible();
  await openAthenaPanel(page, rail);
  await expect(rail.getByRole('group', { name: new RegExp(PROJECT_NAME) })).toBeVisible();
  await expect(
    rail.getByRole('button', { name: new RegExp(`Remove ${PROJECT_NAME}`) }),
  ).toBeVisible();
});
