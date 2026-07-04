/**
 * Baseline + polish capture for the Today page and the calendar/agenda rail.
 *
 * @remarks
 * Throwaway spec: onboards, seeds a few timeboxed daily-plan tasks so the calendar and "Next up"
 * have real content, then screenshots the Today surface and the agenda rail (timeline + list).
 */
import { signUpAndOnboard } from './helpers/app';
import { expect, test } from './helpers/fixtures';
import { apiJson } from './helpers/net';

const SHOTS =
  '/private/tmp/claude-501/-Users-williecubed-Projects-Hypertext-Studio-athena-service/4c880a88-3eec-4e96-a3e8-dcb16ee3a6c9/scratchpad';
const DAY = new Date().toISOString().slice(0, 10);
const at = (h: number, m = 0): string =>
  new Date(`${DAY}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();

test('capture today + calendar baseline', async ({ page }) => {
  const { orgId } = await signUpAndOnboard(page, 'today');
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;

  const plan: [string, number, number][] = [
    ['Draft the launch announcement', 9, 10],
    ['Design review with Kai', 11, 12],
    ['Ship the calendar polish', 14, 15],
    ['Weekly planning', 16, 17],
  ];
  for (const [title, start, end] of plan) {
    const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title, teamId },
    });
    await apiJson(page, `/v1/daily-plan`, {
      method: 'POST',
      body: {
        refOrganizationId: orgId,
        refTaskId: task.id,
        date: DAY,
        timeboxStartsAt: at(start),
        timeboxEndsAt: at(end),
      },
    });
  }

  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Today' }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(4000); // let the today data + agenda settle
  await page.screenshot({ path: `${SHOTS}/today-baseline.png` });

  const rail = page.locator('#shell-aside');
  if ((await rail.count()) > 0) {
    await rail.screenshot({ path: `${SHOTS}/agenda-timeline-baseline.png` }).catch(() => undefined);
  }
});
