/** End-to-end proof that Focus protects the active timer while navigation and task switching work. */
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

const TASK_TITLE = 'Allow modal task creation dialogs to appear on overflow interactions';
const NEXT_TASK_TITLE = 'Write the launch handoff notes';
const CAPTURE_EVIDENCE = process.env['E2E_EVIDENCE'] === '1';
const EVIDENCE_ROOT = resolve(
  process.cwd(),
  '../../docs/design/audits/screenshots/2026-08-20-focus-sidebar-work-switching',
);

/** Capture the standard Focus review matrix and verify its narrow layout and touch targets. */
async function captureFocusEvidence(
  page: Page,
  surface: 'rail' | 'active' | 'idle',
): Promise<void> {
  const frames = [
    { width: 1440, height: 900, label: '1440x900', schemes: ['light', 'dark'] as const },
    { width: 390, height: 844, label: '390x844', schemes: ['light', 'dark'] as const },
    ...(surface === 'idle'
      ? []
      : [{ width: 320, height: 844, label: '320x844', schemes: ['light'] as const }]),
  ];
  for (const frame of frames) {
    await page.setViewportSize({ width: frame.width, height: frame.height });
    for (const scheme of frame.schemes) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const ready = page.getByRole('button', {
        name: surface === 'rail' ? 'Focus mode' : /Return to workspace/,
      });
      if (surface === 'rail' && !(await ready.isVisible())) {
        await page.getByRole('button', { name: 'Show Focus' }).click();
      }
      await ready.waitFor();
      if (surface === 'active') {
        await page.getByText('Backlog', { exact: true }).first().waitFor();
      }
      const directory = surface === 'idle' ? EVIDENCE_ROOT : resolve(EVIDENCE_ROOT, surface);
      const prefix = surface === 'rail' ? 'rail' : 'focus';
      await page.screenshot({
        path: resolve(directory, `${prefix}-${frame.label}-${scheme}.png`),
      });
    }
  }

  await page.setViewportSize({ width: 320, height: 844 });
  const scope =
    surface === 'rail' ? page.locator('section[aria-label="Focus"]:visible') : page.locator('main');
  const measurement = await scope.evaluate((node) => {
    const actionables = [...node.querySelectorAll<HTMLElement>('a, button, input')].filter(
      (element) => element.getClientRects().length > 0,
    );
    return {
      overflow: Math.max(0, node.scrollWidth - node.clientWidth),
      undersized: actionables
        .map((element) => ({
          label: element.getAttribute('aria-label') ?? element.textContent,
          height: element.getBoundingClientRect().height,
        }))
        .filter(({ height }) => height < 39.5),
    };
  });
  expect(measurement.overflow).toBe(0);
  expect(measurement.undersized).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

test('tracked task, task switch, and pop-out stay one flow', async ({ page }) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 240_000 : 120_000);
  const { orgId } = await signUpAndOnboard(page, 'focus-companion');
  const teams = await apiJson<{ items: readonly { id: string }[] }>(
    page,
    `/v1/orgs/${orgId}/teams`,
  );
  const teamId = teams.items[0]?.id;
  expect(teamId, 'Personal onboarding should create one team').toBeTruthy();
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: TASK_TITLE, teamId },
  });

  await page.goto(`/orgs/${orgId}/tasks/${task.id}`);
  await page.getByRole('button', { name: 'Track this task' }).click();
  await expect(page.getByRole('button', { name: 'Pause tracking' })).toBeVisible();

  await page.goto('/today');
  await page.getByRole('button', { name: new RegExp(`^Focus, tracking ${TASK_TITLE}`) }).click();
  const rail = page.locator('#shell-aside');
  await rail.getByRole('link', { name: TASK_TITLE, exact: true }).click();
  await expect(page).toHaveURL(`/orgs/${orgId}/tasks/${task.id}`);

  await page.goto('/today');
  await expect(page.getByRole('button', { name: 'Focus mode' })).toBeVisible();
  const taskField = page.getByRole('searchbox', { name: 'Find or create a task' });
  await taskField.fill(NEXT_TASK_TITLE);
  await taskField.press('Enter');
  await expect(rail.getByRole('link', { name: NEXT_TASK_TITLE, exact: true })).toBeVisible();

  if (CAPTURE_EVIDENCE) await captureFocusEvidence(page, 'rail');

  const popoutPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Focus mode' }).click();
  await page.getByRole('menuitem', { name: 'Open focus mode' }).click();
  const focus = await popoutPromise;
  await expect(focus).toHaveURL('/focus?mode=popout&returnTo=%2Ftoday');
  await expect(
    focus.getByRole('link', { name: NEXT_TASK_TITLE, exact: true }).first(),
  ).toBeVisible();
  if (CAPTURE_EVIDENCE) await captureFocusEvidence(focus, 'active');
  const before = await focus.getByTestId('timer-elapsed').textContent();

  await expect(focus.getByRole('button', { name: 'Pause timer' })).toBeVisible();
  await expect.poll(() => focus.getByTestId('timer-elapsed').textContent()).not.toBe(before);

  await focus.getByRole('button', { name: 'Finish tracking' }).click();
  await expect(
    focus.getByTestId('focus-session').getByRole('link', { name: NEXT_TASK_TITLE, exact: true }),
  ).toHaveCount(0);
  await expect(focus.getByRole('button', { name: 'Resume timer' })).toBeVisible();
  await focus.getByRole('button', { name: 'Finish tracking' }).click();
  await expect(focus.getByText('Ready for the next thing.')).toBeVisible();
  if (CAPTURE_EVIDENCE) await captureFocusEvidence(focus, 'idle');
});
