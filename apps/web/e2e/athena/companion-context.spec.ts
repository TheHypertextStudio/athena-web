import type { Page, Route } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

const createdAt = '2026-09-13T09:00:00.000Z';

/** Serve one piece of waiting Athena work so the rail has something to select. */
async function installAthenaFixture(page: Page, orgId: string): Promise<void> {
  const session = {
    id: 'athena_companion_session',
    kind: 'job',
    status: 'awaiting_approval',
    queueState: 'needs_you',
    objective: 'Draft sponsor outreach and reschedule printing',
    context: { workspaceId: orgId },
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
}

test('the Athena panel keeps its selected work while the person moves between pages', async ({
  page,
}) => {
  const { orgId } = await signUpAndOnboard(page, 'athena-companion');
  await installAthenaFixture(page, orgId);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/today');
  await page.keyboard.press('Meta+J');
  const rail = page.getByRole('complementary', { name: 'Athena' });
  await rail.getByRole('button', { name: /Draft sponsor outreach/ }).click();
  await expect(rail.getByRole('heading', { name: /Draft sponsor outreach/ })).toBeVisible();

  // Client-side navigation through the sidebar; a full page load would be a different test.
  await page
    .getByRole('navigation', { name: 'Home' })
    .getByRole('link', { name: /Inbox/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/inbox/);

  await expect(rail.getByRole('heading', { name: /Draft sponsor outreach/ })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Back' })).toBeVisible();
});
