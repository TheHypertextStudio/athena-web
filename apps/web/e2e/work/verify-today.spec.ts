/**
 * Baseline + polish capture for the Today page and the calendar/agenda rail.
 *
 * @remarks
 * Evidence spec: onboards, seeds accepted work connected to one Project and Initiative, verifies
 * the finite Now/After sequence and grounded status cards, completes Now inline, then screenshots
 * the operating surface and agenda rail.
 */
import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

function testTimezone(): { readonly name: string; readonly offsetHours: number } {
  const utcHour = new Date().getUTCHours();
  let offsetHours = 1 - utcHour;
  if (offsetHours < -12) offsetHours += 24;
  const name =
    offsetHours === 0
      ? 'UTC'
      : offsetHours > 0
        ? `Etc/GMT-${String(offsetHours)}`
        : `Etc/GMT+${String(Math.abs(offsetHours))}`;
  return { name, offsetHours };
}

function dateInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (kind: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === kind)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

const at = (day: string, h: number, offsetHours: number, m = 0): string => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date, h - offsetHours, m)).toISOString();
};

test('capture today + calendar baseline', async ({ page }, testInfo) => {
  const { orgId } = await signUpAndOnboard(page, 'today');
  const timezone = testTimezone();
  const day = dateInTimezone(timezone.name);
  const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay();
  await apiJson(page, '/v1/hub/preferences', {
    method: 'PATCH',
    body: { timezone: timezone.name },
  });
  await apiJson(page, '/v1/schedule-week/preferences', {
    method: 'PUT',
    body: {
      timezone: timezone.name,
      windows: [{ weekday, startMinute: 0, endMinute: 1439, kind: 'desk', label: 'Test workday' }],
    },
  });

  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Plan today with Athena' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('textbox', { name: 'Ask Athena about today' }).fill('Help me plan today');
  await page.getByRole('button', { name: 'Ask Athena', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Athena', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close Athena' })).toBeVisible();
  await page.getByRole('button', { name: 'Close Athena' }).click();
  await expect(page.getByRole('button', { name: 'Plan today with Athena' })).toBeVisible();

  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  const members = await apiJson<{ items: { actorId: string }[] }>(
    page,
    `/v1/orgs/${orgId}/members`,
  );
  const assigneeId = members.items[0]?.actorId;
  expect(teamId && assigneeId, 'onboarding must mint a team + member').toBeTruthy();
  const initiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: {
      name: 'A calmer launch',
      summary: 'Make the release legible and dependable.',
      health: 'on_track',
    },
  });
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: {
      name: 'Launch Docket',
      teamId,
      status: 'active',
      health: 'at_risk',
      initiativeIds: [initiative.id],
    },
  });

  const plan: [string, number, number][] = [
    ['Draft the launch announcement', 15, 16],
    ['Design review with Kai', 17, 18],
    ['Ship the calendar polish', 19, 20],
    ['Weekly planning', 21, 22],
  ];
  for (const [title, start, end] of plan) {
    const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title, teamId, projectId: project.id },
    });
    await apiJson(page, `/v1/daily-plan`, {
      method: 'POST',
      body: {
        refOrganizationId: orgId,
        refTaskId: task.id,
        date: day,
        timeboxStartsAt: at(day, start, timezone.offsetHours),
        timeboxEndsAt: at(day, end, timezone.offsetHours),
      },
    });
  }
  for (const [title, estimateMinutes] of [
    ['Tighten the release checklist', 20],
    ['Reply to launch feedback', 30],
  ] as const) {
    await apiJson(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title, teamId, assigneeId, estimateMinutes },
    });
  }

  // Scope the console gate to the surface under review. The reusable sign-up helper intentionally
  // probes retryable auth paths while enrolling a virtual passkey; those requests are not Today.
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Today' }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(4000); // let the today data + agenda settle
  await expect(page.getByRole('article', { name: `Now: ${plan[0]![0]}` })).toBeVisible();
  await expect(page.getByRole('article', { name: `After this: ${plan[1]![0]}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Work in motion' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Launch Docket', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'A calmer launch', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('today-baseline.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const control of [
    page.getByRole('button', { name: 'Ask Athena' }),
    page.getByRole('button', { name: /Switch to Add a task/ }),
  ]) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('today-active-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page
    .getByRole('article', { name: `Now: ${plan[0]![0]}` })
    .getByRole('button', { name: 'Mark complete' })
    .click();
  await expect(page.getByRole('article', { name: `Now: ${plan[1]![0]}` })).toBeVisible();
  await expect(page.getByText('1 of 4 tasks complete')).toBeVisible();
  await page.getByRole('heading', { name: 'Work in motion' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('today-work-in-motion.png') });

  for (const [title] of plan.slice(1)) {
    const current = page.getByRole('article', { name: `Now: ${title}` });
    await current.getByRole('button', { name: 'Mark complete' }).click();
    await expect(current).toHaveCount(0);
  }
  await expect(page.getByRole('heading', { name: 'Keep the momentum' })).toBeVisible();
  await expect(page.getByText('Tighten the release checklist')).toBeVisible();
  await expect(page.getByText('Reply to launch feedback')).toBeVisible();
  await page.getByRole('heading', { name: 'Keep the momentum' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('today-momentum.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Keep the momentum' }).scrollIntoViewIfNeeded();
  for (const control of [
    page.getByRole('button', { name: 'Start now' }).first(),
    page.getByRole('button', { name: 'Add to today' }).first(),
    page.getByRole('button', { name: 'Dismiss' }).first(),
  ]) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('today-momentum-mobile.png') });

  const rail = page.locator('#shell-aside');
  if ((await rail.count()) > 0) {
    await rail
      .screenshot({ path: testInfo.outputPath('agenda-timeline-baseline.png') })
      .catch(() => undefined);
  }
  expect(consoleErrors).toEqual([]);
});
