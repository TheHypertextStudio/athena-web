/** Authenticated acceptance for configurable cadence and quarter-ahead task planning. */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

test.use({ serviceWorkers: 'block' });

function endOfNextQuarter(date: Date): string {
  const quarter = Math.floor(date.getUTCMonth() / 3);
  return new Date(Date.UTC(date.getUTCFullYear(), (quarter + 2) * 3, 0)).toISOString().slice(0, 10);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
}

test('a daily team can assign and retain work at the end of next quarter', async ({ page }) => {
  test.setTimeout(600_000);
  const { orgId } = await signUpAndOnboard(page, 'FutureCycles');
  const teams = await apiJson<{ items: { id: string; name: string }[] }>(
    page,
    `/v1/orgs/${orgId}/teams`,
  );
  const team = teams.items[0];
  expect(team).toBeTruthy();
  if (!team) throw new Error('Onboarding did not create a team.');

  await page.goto(orgHref(orgId, `teams/${team.id}`), { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByLabel('Cycle length')).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await page.getByLabel('Cycle length').fill('1');
  await page.getByRole('button', { name: 'Save cadence' }).click();
  await expect(page.getByRole('status')).toContainText('Existing assignments did not move.');

  const created = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Quarter-ahead daily plan', teamId: team.id },
  });
  await page.goto(orgHref(orgId, `tasks/${created.id}`), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Quarter-ahead daily plan' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: /Cycle — not set/ }).click();
  const targetDate = endOfNextQuarter(new Date());
  await expect
    .poll(
      async () => {
        const cycles = await apiJson<{
          items: { id: string; teamId: string; startsAt: string; displayName: string }[];
        }>(page, `/v1/orgs/${orgId}/cycles`);
        return cycles.items.find(
          (cycle) => cycle.teamId === team.id && cycle.startsAt.slice(0, 10) === targetDate,
        );
      },
      { timeout: TIMEOUTS.sweep },
    )
    .toBeTruthy();
  const cycles = await apiJson<{
    items: { id: string; teamId: string; startsAt: string; displayName: string }[];
  }>(page, `/v1/orgs/${orgId}/cycles`);
  const target = cycles.items.find(
    (cycle) => cycle.teamId === team.id && cycle.startsAt.slice(0, 10) === targetDate,
  );
  if (!target) throw new Error('The picker did not generate the quarter-ahead daily cycle.');

  const search = page.getByLabel('Search Cycle');
  await search.fill(target.displayName);
  await page
    .getByRole('option', { name: new RegExp(target.displayName) })
    .getByRole('button')
    .click();
  await expect
    .poll(async () => {
      const task = await apiJson<{ cycleId: string | null }>(
        page,
        `/v1/orgs/${orgId}/tasks/${created.id}`,
      );
      return task.cycleId;
    })
    .toBe(target.id);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('button', { name: new RegExp(`Cycle — ${target.displayName}`) }),
  ).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: new RegExp(`Cycle — ${target.displayName}`) }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByRole('listbox', { name: 'Cycle' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
