/** End-to-end proof for scheduling a task through its current calendar action. */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

const STARTS_AT = '2026-07-13T17:00:00.000Z';
const ENDS_AT = '2026-07-13T17:30:00.000Z';

interface CalendarRange {
  readonly items: readonly {
    readonly title: string;
    readonly startsAt: string | null;
    readonly endsAt: string | null;
    readonly linkedTasks: readonly {
      readonly taskId: string;
      readonly role: string;
    }[];
  }[];
}

/** Create one task through the real organization API. */
async function createTask(page: Page, organizationId: string, title: string): Promise<string> {
  const teams = await apiJson<{ readonly items: readonly { readonly id: string }[] }>(
    page,
    `/v1/orgs/${organizationId}/teams`,
  );
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('Onboarding produced no team.');
  return (
    await apiJson<{ readonly id: string }>(page, `/v1/orgs/${organizationId}/tasks`, {
      method: 'POST',
      body: { title, teamId },
    })
  ).id;
}

test.use({ timezoneId: 'UTC' });

test('schedules a task from its action menu and persists the contained calendar link', async ({
  page,
}) => {
  const { orgId } = await signUpAndOnboard(page, 'TaskCalendar');
  const title = 'Draft launch brief';
  const taskId = await createTask(page, orgId, title);

  await page.goto(orgHref(orgId, 'tasks'), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  const taskRow = page.locator(`[data-object-kind="task"][data-object-id="${taskId}"]`).first();
  await expect(taskRow).toBeVisible({ timeout: TIMEOUTS.pageReady });

  const scheduleAction = page.getByRole('menuitem', { name: 'Schedule on calendar' });
  await expect(async () => {
    await taskRow.dispatchEvent('contextmenu', { clientX: 420, clientY: 200 });
    await expect(scheduleAction).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: TIMEOUTS.pageReady });
  await scheduleAction.click();

  const scheduleStart = page.getByLabel('Schedule start');
  await expect(scheduleStart).toBeVisible();
  await scheduleStart.fill('2026-07-13T17:00');
  await page.getByRole('button', { name: 'Schedule for 30 minutes' }).click();

  const query = new URLSearchParams({
    start: '2026-07-13T00:00:00.000Z',
    end: '2026-07-14T00:00:00.000Z',
  });
  await expect
    .poll(async () => {
      const range = await apiJson<CalendarRange>(page, `/v1/me/calendar/items?${query.toString()}`);
      const item = range.items.find((candidate) => candidate.title === title);
      return item
        ? {
            startsAt: item.startsAt,
            endsAt: item.endsAt,
            taskLink: item.linkedTasks.find((link) => link.taskId === taskId),
          }
        : null;
    })
    .toMatchObject({
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      taskLink: { taskId, role: 'contained' },
    });
});
