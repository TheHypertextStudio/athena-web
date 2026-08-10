/** End-to-end proof that Focus protects the active timer while navigation and Athena stay useful. */
import { resolve } from 'node:path';

import type { Page, Route } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

const TASK_TITLE = 'Allow modal task creation dialogs to appear on overflow interactions';
const INTERRUPTION = 'I just remembered I need to create a dentist appointment';
const CAPTURE_EVIDENCE = process.env['E2E_EVIDENCE'] === '1';
const EVIDENCE_ROOT = resolve(
  process.cwd(),
  '../../docs/design/audits/screenshots/2026-08-09-focus-working-companion',
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
        name: surface === 'rail' ? 'Open focus mode' : /Return to workspace/,
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

/** Install a deterministic Personal-Athena response and retain the submitted invocation body. */
async function installFocusHandoff(
  route: Route,
  orgId: string,
  readBody: (body: Readonly<Record<string, unknown>>) => void,
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const createdAt = new Date().toISOString();
  const detail = {
    id: '01KZMF0CUSHANDOFF000000000',
    kind: 'job',
    status: 'running',
    queueState: 'working',
    objective: INTERRUPTION,
    context: { workspaceId: orgId },
    workspace: { id: orgId, name: 'Personal' },
    startedAt: createdAt,
    endedAt: null,
    createdAt,
    activities: [],
  } as const;

  if (request.method() === 'POST' && url.pathname === '/v1/me/athena/sessions') {
    readBody(request.postDataJSON() as Readonly<Record<string, unknown>>);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail),
    });
    return;
  }
  if (request.method() === 'GET' && url.pathname === `/v1/me/athena/sessions/${detail.id}`) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail),
    });
    return;
  }
  await route.fallback();
}

test('tracked task, pop-out, and personal interruption handoff stay one flow', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: 'Open focus mode' })).toBeVisible();
  let handoffBody: Readonly<Record<string, unknown>> | null = null;
  await page.context().route('**/v1/me/athena/sessions**', (route) =>
    installFocusHandoff(route, orgId, (body) => {
      handoffBody = body;
    }),
  );

  if (CAPTURE_EVIDENCE) await captureFocusEvidence(page, 'rail');

  const popoutPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open focus mode' }).click();
  const focus = await popoutPromise;
  await expect(focus).toHaveURL('/focus?mode=popout&returnTo=%2Ftoday');
  await expect(focus.getByRole('link', { name: TASK_TITLE, exact: true }).first()).toBeVisible();
  if (CAPTURE_EVIDENCE) await captureFocusEvidence(focus, 'active');
  const before = await focus.getByTestId('timer-elapsed').textContent();

  await focus.getByRole('textbox', { name: 'Hand something to Athena' }).fill(INTERRUPTION);
  await focus.getByRole('button', { name: 'Hand to Athena' }).click();
  await expect(focus.getByText('Athena is handling it.')).toBeVisible();
  expect(handoffBody).toEqual({ prompt: INTERRUPTION });
  await expect(focus.getByRole('button', { name: 'Pause timer' })).toBeVisible();
  await expect.poll(() => focus.getByTestId('timer-elapsed').textContent()).not.toBe(before);

  await focus.getByRole('button', { name: 'Finish tracking' }).click();
  await expect(focus.getByText('Ready for the next thing.')).toBeVisible();
  if (CAPTURE_EVIDENCE) await captureFocusEvidence(focus, 'idle');
});
