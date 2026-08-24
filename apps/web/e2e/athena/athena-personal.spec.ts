import type { Page, Route } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

const createdAt = '2026-07-15T15:00:00.000Z';

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
    if (request.method() === 'GET' && path === '/v1/me/athena/pulse') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ needsYou: 1, working: 0 }),
      });
      return;
    }
    if (request.method() === 'GET' && path === '/v1/me/athena') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          counts: { needsYou: 1, working: 0, finished: 0 },
          currentChat: null,
          sessions: { needsYou: [session], working: [], finished: [] },
        }),
      });
      return;
    }
    if (request.method() === 'GET' && path === `/v1/me/athena/sessions/${session.id}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
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

  await page.keyboard.press('Meta+J');
  const desktopRail = page.getByRole('complementary', { name: 'Athena' });
  await expect(desktopRail).toBeVisible();
  const session = desktopRail.getByRole('button', {
    name: /Protect two hours for the launch review/,
  });
  await expect(session).toBeVisible();
  await session.click();
  await expect(desktopRail.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(
    desktopRail.getByRole('heading', { name: 'Protect two hours for the launch review' }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('athena-rail-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Meta+J');
  const mobileRail = page.getByRole('dialog', { name: 'Athena' });
  await expect(mobileRail).toBeVisible();
  await expect(mobileRail.getByRole('button', { name: 'Open Athena', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('athena-rail-mobile.png'), fullPage: true });

  await page.goto('/calendar');
  await expect(page.getByRole('complementary', { name: 'Athena' })).toHaveCount(0);
  await page.keyboard.press('Meta+J');
  await expect(page).toHaveURL('/athena');
  await expect(page.getByRole('heading', { name: 'Your Athena work' })).toBeVisible();
});
