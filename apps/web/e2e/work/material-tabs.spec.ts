/** Content tabs keep their own lane, identity and keyboard focus across entity pages. */
import { apiJson } from '../helpers/net';
import { signUpAndOnboard } from '../helpers/app';
import { createMobileAuditFixture } from '../helpers/mobile-audit-fixture';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test.use({ serviceWorkers: 'block' });

test('content tabs preserve panel associations and reach every destination at narrow widths', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signUpAndOnboard(page, 'ContentTabs');
  const fixture = await createMobileAuditFixture(page);
  const preferences = await apiJson<{ timezone: string }>(page, '/v1/schedule-week/preferences');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: preferences.timezone });
  await page.goto(`/plan/day?date=${today}`);
  await expect(page.getByRole('heading', { name: 'Plan today' })).toBeVisible();
  const routes = [
    { path: `tasks/${fixture.taskId}`, label: 'Task sections' },
    { path: `projects/${fixture.projectId}`, label: 'Project sections' },
    { path: `initiatives/${fixture.initiativeId}`, label: 'Initiative sections' },
    { path: `programs/${fixture.programId}`, label: 'Program sections' },
    { path: `teams/${fixture.teamId}`, label: 'Team sections' },
  ];
  for (const route of routes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(orgHref(fixture.orgId, route.path));
    const tabs = page.getByRole('tablist', { name: route.label });
    await expect(tabs).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await expect
      .poll(() => tabs.evaluate((element) => element.getBoundingClientRect().height))
      .toBe(48);
    await page.setViewportSize({ width: 320, height: 844 });
    for (const trigger of await tabs.getByRole('tab').all()) {
      const target = await trigger.getAttribute('aria-controls');
      await expect(page.locator(`[id="${target}"]`)).toHaveCount(1);
    }
    const first = tabs.getByRole('tab', { selected: true });
    await first.focus();
    await first.press('End');
    const selected = tabs.getByRole('tab', { selected: true });
    await expect(selected).toBeFocused();
    const controls = await selected.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    const panel = page.locator(`[id="${controls}"]`);
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    await expect(panel).toHaveAttribute(
      'aria-labelledby',
      (await selected.getAttribute('id')) ?? '',
    );
    await expect(panel).toBeVisible();
    const geometry = await tabs.evaluate((element) => {
      const lane = element.getBoundingClientRect();
      const active = element.querySelector('[aria-selected="true"]')?.getBoundingClientRect();
      return {
        laneLeft: lane.left,
        laneRight: lane.right,
        left: active?.left,
        right: active?.right,
        pageWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.laneLeft - 1);
    expect(geometry.right).toBeLessThanOrEqual(geometry.laneRight + 1);
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(
      await page.locator('[id]').evaluateAll((elements) => {
        const ids = elements.map((element) => element.id);
        return ids.filter((id, index) => ids.indexOf(id) !== index);
      }),
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(orgHref(fixture.orgId, 'projects'));
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'New project' });
  const sections = composer.getByRole('tablist', { name: 'Composer sections' });
  await expect(sections).toBeVisible();
  const [track, dialog] = await Promise.all([sections.boundingBox(), composer.boundingBox()]);
  expect(track?.width ?? 0).toBeGreaterThanOrEqual((dialog?.width ?? 390) - 65);
});
