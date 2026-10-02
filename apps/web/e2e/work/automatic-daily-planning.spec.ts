import { instantAt } from '@docket/planning/zoned-time';

import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

test.use({ serviceWorkers: 'block' });

test('an open app enters the saved daily planner at workday start and does not redirect again', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const timezone = 'America/Los_Angeles';
  const date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  await page.clock.install({ time: instantAt(date, 480, timezone) });
  const { orgId } = await signUpAndOnboard(page, 'automatic-daily-planning');
  await apiJson(page, '/v1/hub/preferences', { method: 'PATCH', body: { timezone } });
  await apiJson(page, '/v1/schedule-week/preferences', {
    method: 'PUT',
    body: { windows: [{ weekday, startMinute: 540, endMinute: 1020, kind: 'desk', label: null }] },
  });
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Write the launch update', teamId: teams.items[0]?.id },
  });
  await apiJson(page, `/v1/daily-plan/day/${date}/draft`, {
    method: 'PUT',
    body: {
      resumeStep: 'review_plan',
      draft: {
        date,
        finishAt: instantAt(date, 1020, timezone).toISOString(),
        mainTaskId: null,
        tasks: [{ taskId: task.id, organizationId: orgId, plannedMinutes: 30, sort: 0 }],
        sessions: [
          {
            id: 'launch-update',
            startsAt: instantAt(date, 600, timezone).toISOString(),
            endsAt: instantAt(date, 630, timezone).toISOString(),
            allocations: [{ taskId: task.id, plannedMinutes: 30 }],
            pinned: false,
          },
        ],
      },
    },
  });
  await page.goto('/inbox', { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await setColorScheme(page, 'light');
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'It’s time to plan your day' })).toHaveCount(0);
  await page.clock.pauseAt(instantAt(date, 540, timezone));
  const announcement = page.getByRole('dialog', { name: 'It’s time to plan your day' });
  await expect
    .poll(async () => {
      if (!(await announcement.isVisible())) await page.clock.runFor(100);
      return announcement.isVisible();
    })
    .toBe(true);
  await expect(announcement.getByText('Opening planner in 5 seconds.')).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath('announcement-desktop.png'),
    animations: 'disabled',
  });
  await setColorScheme(page, 'dark');
  await page.screenshot({
    path: testInfo.outputPath('announcement-desktop-dark.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('announcement-phone-dark.png'),
    animations: 'disabled',
  });
  await setColorScheme(page, 'light');
  await page.screenshot({
    path: testInfo.outputPath('announcement-phone.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 320, height: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const dialogBounds = await announcement.boundingBox();
  const actionBounds = await announcement.getByRole('button', { name: 'Plan now' }).boundingBox();
  if (!dialogBounds || !actionBounds) throw new Error('The planning announcement must be visible');
  expect(dialogBounds.y).toBeGreaterThanOrEqual(0);
  expect(dialogBounds.y + dialogBounds.height).toBeLessThanOrEqual(600);
  expect(actionBounds.height).toBeGreaterThanOrEqual(40);
  await page.screenshot({
    path: testInfo.outputPath('announcement-narrow-phone.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.runFor(4_000);
  await expect(announcement.getByText('Opening planner in 1 second.')).toBeVisible();
  await expect(page).toHaveURL(/\/inbox$/);
  await page.clock.runFor(1_000);
  await expect(page).toHaveURL(`/plan?view=day&date=${date}`);
  await page.clock.resume();
  await expect(page.getByRole('heading', { name: 'Review plan', exact: true })).toBeVisible();
  await expect(page.getByText('Write the launch update').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('planner-phone.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('planner-desktop.png') });
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await page.clock.runFor(10_000);
  await expect(announcement).toHaveCount(0);
  await expect(page).toHaveURL(/\/today$/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.clock.runFor(10_000);
  await expect(announcement).toHaveCount(0);
  await expect(page).toHaveURL(/\/today$/);
});
