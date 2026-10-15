import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test('Time keeps its total and view selector in separate mobile rows', async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndOnboard(page, 'TimeMobileSummary');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/time', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
    await expect(page.getByRole('heading', { name: 'Time' })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });

    const total = page.locator('span').filter({ hasText: /^0m$/ });
    const selector = page.locator('[aria-label="Time view"]');
    await expect(total).toBeVisible();
    await expect(selector).toBeVisible();
    const { totalBottom, selectorTop, widths } = await page.evaluate(() => {
      const total = Array.from(document.querySelectorAll('span')).find(
        (element) => element.textContent === '0m',
      );
      const selector = document.querySelector<HTMLElement>('[aria-label="Time view"]');
      if (!total || !selector) throw new Error('Time summary controls did not render.');
      return {
        totalBottom: total.getBoundingClientRect().bottom,
        selectorTop: selector.getBoundingClientRect().top,
        widths: { document: document.documentElement.scrollWidth, viewport: innerWidth },
      };
    });

    expect(totalBottom).toBeLessThanOrEqual(selectorTop + 1);
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  }
});

test.describe('planning recovery runtime', () => {
  const session = process.env['E2E_PLANNING_SESSION'];
  if (session) test.use({ storageState: session });

  test('retains cycle Previous Next and Today through reload and narrow overflow', async ({
    page,
  }) => {
    const { apiJson } = await import('../helpers/net');
    const { addDays } = await import('@docket/planning/zoned-time');
    await page.goto('/today', { waitUntil: 'domcontentloaded' });
    const orgId = session
      ? (await apiJson<{ items: { id: string }[] }>(page, '/v1/orgs')).items[0]?.id
      : (await signUpAndOnboard(page, 'CycleNavigationRecovery')).orgId;
    if (!orgId) throw new Error('The authenticated workspace is missing.');
    await apiJson(page, '/v1/hub/preferences', { method: 'PATCH', body: { timezone: 'UTC' } });
    const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
    const today = new Date().toISOString().slice(0, 10);
    const existing = await apiJson<{
      items: { id: string; name: string | null; startsAt: string }[];
    }>(page, `/v1/orgs/${orgId}/cycles`);
    const cycles: { id: string; name: string; startsAt: string }[] = [];
    for (const [index, offset] of [-15, -1, 13].entries()) {
      const name = [
        'Previous acceptance cycle',
        'Current acceptance cycle',
        'Next acceptance cycle',
      ][index];
      const cycle =
        existing.items.find(
          (cycle) => cycle.name === name && cycle.startsAt.startsWith(addDays(today, offset)),
        ) ??
        (await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/cycles`, {
          method: 'POST',
          body: {
            teamId: teams.items[0]?.id,
            number: 30001 + index,
            name,
            startsAt: addDays(today, offset),
            endsAt: addDays(today, offset + 14),
          },
        }));
      cycles.push({ id: cycle.id, name: name ?? '', startsAt: addDays(today, offset) });
    }
    const [previous, current, next] = cycles;
    if (!previous || !current || !next) throw new Error('Cycle fixtures were not created.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/time?period=cycle&cycleId=${current.id}&workspaceId=${orgId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText(current.name, { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Previous cycle', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`cycleId=${previous.id}`));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(previous.name, { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Next cycle', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`cycleId=${current.id}`));
    await page.getByRole('button', { name: 'Next cycle', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`cycleId=${next.id}`));
    await page.setViewportSize({ width: 320, height: 600 });
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`cycleId=${current.id}`));
    await expect(page).toHaveURL(new RegExp(`anchor=${today}`));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(current.name, { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'More time controls', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Month', exact: true }).click();
    await expect(page).toHaveURL(/period=month/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const evidence = process.env['E2E_PLANNING_EVIDENCE'];
    if (evidence) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        `${evidence}/cycle-fixture.json`,
        JSON.stringify({ orgId, today, cycles }, null, 2),
      );
    }
  });
});
