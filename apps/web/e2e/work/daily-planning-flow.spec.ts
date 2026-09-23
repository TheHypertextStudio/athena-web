/** A person can accept a morning plan without Athena and use it on Today. */
import { addDays, instantAt } from '@docket/planning/zoned-time';
import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

test('a first plan starts with available work', async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndOnboard(page, 'daily-first-plan');
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'Plan day' }).click();
  await expect(page.getByRole('heading', { name: 'Add work' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Plan today' })).toBeVisible();
});

test('a selected task can be dragged into tomorrow’s agenda', async ({ page }) => {
  test.setTimeout(120_000);
  const { orgId } = await signUpAndOnboard(page, 'daily-drag');
  const timezone = 'America/Los_Angeles';
  await apiJson(page, '/v1/hub/preferences', { method: 'PATCH', body: { timezone } });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const tomorrow = addDays(today, 1);
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Draft tomorrow’s brief', teamId: teams.items[0]?.id },
  });
  await apiJson(page, '/v1/daily-plan', {
    method: 'POST',
    body: { refOrganizationId: orgId, refTaskId: task.id, date: tomorrow },
  });

  await page.goto(`/plan?view=day&date=${tomorrow}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Plan tomorrow' })).toBeVisible();
  const handle = page.getByRole('button', { name: 'Drag Draft tomorrow’s brief to agenda' });
  const agenda = page.getByLabel('Day agenda');
  const source = await handle.boundingBox();
  const destination = await agenda.boundingBox();
  if (!source || !destination) throw new Error('The task handle and agenda must be visible');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, {
    steps: 4,
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['draggingKind']))
    .toBe('task');
  await page.mouse.move(destination.x + 100, destination.y + 150, { steps: 12 });
  await expect(agenda).toHaveAttribute('data-drop-state', 'accept');
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /Edit Draft tomorrow’s brief at/ })).toBeVisible();
});

test('review yesterday, schedule work, and begin an accepted day', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { orgId } = await signUpAndOnboard(page, 'daily-planning');
  const timezone = 'America/Los_Angeles';
  await apiJson(page, '/v1/hub/preferences', { method: 'PATCH', body: { timezone } });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  expect(teamId).toBeTruthy();
  const titles = ['Write launch update', 'Review customer notes', 'Prepare release checklist'];
  for (const [index, title] of titles.entries()) {
    const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title, teamId },
    });
    await apiJson(page, '/v1/daily-plan', {
      method: 'POST',
      body: { refOrganizationId: orgId, refTaskId: task.id, date: index === 2 ? yesterday : today },
    });
  }

  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  const entry = page.getByRole('link', { name: 'Plan day' });
  await expect(entry).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('today-entry-desktop-light.png') });
  await entry.click();
  await expect(page.getByRole('heading', { name: 'Review yesterday' })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Decision for Prepare release checklist' })
    .selectOption('today');
  await page.screenshot({ path: testInfo.outputPath('yesterday-desktop-light.png') });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Plan today' })).toBeVisible();
  await expect(page.getByLabel('Finish work at')).toHaveValue('17:00');
  await expect(
    page.getByRole('textbox', { name: 'Task title: Prepare release checklist' }),
  ).toBeVisible();
  let saveFailed = false;
  await page.route('**/v1/daily-plan/day/*/draft', async (route) => {
    if (route.request().method() === 'PUT' && !saveFailed) {
      saveFailed = true;
      await route.fulfill({ status: 503, body: '{}', contentType: 'application/json' });
      return;
    }
    await route.continue();
  });
  await page
    .getByRole('combobox', { name: 'Planned time for Review customer notes' })
    .selectOption('60');
  await expect(page.getByRole('alert').getByText('Save failed.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('alert').getByText('Save failed.', { exact: false })).toHaveCount(0);
  await expect(
    page.getByRole('combobox', { name: 'Planned time for Review customer notes' }),
  ).toHaveValue('60');
  await page.unroute('**/v1/daily-plan/day/*/draft');
  await page.getByRole('button', { name: 'Schedule Write launch update', exact: true }).click();
  await expect(page.getByText('Schedule task', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(page.getByText('Schedule task', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Edit Write launch update at/ })).toBeVisible();
  await page.getByRole('button', { name: 'Schedule Review customer notes', exact: true }).click();
  await page.getByLabel('Add task to block').selectOption({ label: 'Prepare release checklist' });
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(
    page.getByRole('button', {
      name: /Edit Review customer notes and Prepare release checklist at/,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Schedule Write launch update', exact: true }).click();
  await page.getByRole('button', { name: 'Save block' }).click();
  await expect(page.getByRole('button', { name: /Edit Write launch update at/ })).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('plan-desktop-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('plan-phone-light.png'), fullPage: true });
  await setColorScheme(page, 'dark');
  await page.screenshot({ path: testInfo.outputPath('plan-phone-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await setColorScheme(page, 'light');
  await page.getByRole('button', { name: 'Review plan' }).click();
  await expect(page.getByRole('heading', { name: 'Review plan' })).toBeVisible();
  await expect(page.getByText('Summary')).toBeVisible();
  await page.getByRole('heading', { name: 'Review plan' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('review-desktop-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Review plan' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('review-phone-light.png'), fullPage: true });
  await setColorScheme(page, 'dark');
  await page.screenshot({ path: testInfo.outputPath('review-phone-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('review-desktop-dark.png') });
  await page.getByRole('button', { name: 'Confirm plan' }).click();
  await expect(page.getByRole('heading', { name: 'Your plan is set' }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('confirmed-desktop-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('confirmed-phone-dark.png') });
  await setColorScheme(page, 'light');
  await page.screenshot({ path: testInfo.outputPath('confirmed-phone-light.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('confirmed-desktop-light.png') });
  await setColorScheme(page, 'dark');
  await page.getByRole('link', { name: 'Go to Today' }).click();
  await expect(page.getByRole('link', { name: 'Adjust today' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Write launch update' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('today-accepted-desktop-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('today-accepted-phone-dark.png') });
  await setColorScheme(page, 'light');
  await page.screenshot({ path: testInfo.outputPath('today-accepted-phone-light.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('today-accepted-desktop-light.png') });
  await page.getByRole('link', { name: 'Adjust today' }).click();
  await expect(page.getByRole('heading', { name: 'Plan today' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Review customer notes from today' }).click();
  await page.getByRole('button', { name: 'Review plan' }).click();
  await expect(page.getByText('Removed Review customer notes')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm plan' }).click();
  await expect(page.getByRole('heading', { name: 'Plan updated' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo update' }).click();
  await page.getByRole('link', { name: 'Go to Today' }).click();
  await expect(
    page.getByRole('link', { name: 'Open Review customer notes details' }),
  ).toBeVisible();
});

test('a missed block opens a reversible agenda revision', async ({ page }) => {
  test.setTimeout(180_000);
  const { orgId } = await signUpAndOnboard(page, 'daily-recovery');
  const timezone = 'America/Los_Angeles';
  await apiJson(page, '/v1/hub/preferences', { method: 'PATCH', body: { timezone } });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Call the supplier', teamId: teams.items[0]?.id },
  });
  const startsAt = instantAt(today, 9 * 60, timezone).toISOString();
  const endsAt = instantAt(today, 9 * 60 + 30, timezone).toISOString();
  await apiJson(page, `/v1/daily-plan/day/${today}/draft`, {
    method: 'PUT',
    body: {
      resumeStep: 'review_plan',
      draft: {
        date: today,
        finishAt: instantAt(today, 17 * 60, timezone).toISOString(),
        mainTaskId: null,
        tasks: [{ taskId: task.id, organizationId: orgId, plannedMinutes: 30, sort: 0 }],
        sessions: [
          {
            id: 'supplier-block',
            startsAt,
            endsAt,
            allocations: [{ taskId: task.id, plannedMinutes: 30 }],
            pinned: false,
          },
        ],
      },
    },
  });
  await apiJson(page, `/v1/daily-plan/day/${today}/confirm`, { method: 'POST' });
  await page.clock.install({ time: instantAt(today, 15 * 60, timezone) });
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Planned for 9:00 AM')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog', { name: 'Add past time' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Not started' }).click();
  await expect(page.getByRole('heading', { name: 'Review plan' })).toBeVisible();
  await expect(
    page.getByText('Schedule changed. Review the agenda below before confirming.'),
  ).toBeVisible();
  await expect(page.getByText('Call the supplier').first()).toBeVisible();
  await page.getByRole('button', { name: 'Confirm plan' }).click();
  await expect(page.getByRole('button', { name: 'Undo update' })).toBeVisible();
});
