import type { Page, Route } from '@playwright/test';

import { signUpAndOnboard } from './helpers/app';
import { expect, test } from './helpers/fixtures';

const createdAt = '2026-07-15T15:00:00.000Z';

/** Convert a computed RGB or OKLCH color to relative luminance. */
function relativeLuminance(color: string): number {
  const channels = color.match(/[-\d.]+/g)?.map(Number) ?? [];
  if (color.startsWith('oklch') || color.startsWith('oklab')) {
    const [lightness = 0, second = 0, third = 0] = channels;
    const radians = (third * Math.PI) / 180;
    const a = color.startsWith('oklch') ? second * Math.cos(radians) : second;
    const b = color.startsWith('oklch') ? second * Math.sin(radians) : third;
    const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
    const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
    const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
    const l = lRoot ** 3;
    const m = mRoot ** 3;
    const s = sRoot ** 3;
    const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }
  const linear = channels.slice(0, 3).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

/** Install the personal API fixture until the generated client lane lands in this worktree. */
async function installAthenaFixture(page: Page, orgId: string): Promise<void> {
  const summary = {
    id: 'athena_fixture_session',
    kind: 'job',
    status: 'awaiting_approval',
    queueState: 'needs_you',
    objective: 'Protect two hours for the launch review',
    context: { workspaceId: orgId, source: { type: 'project', id: 'project_fixture' } },
    startedAt: createdAt,
    endedAt: null,
    createdAt,
  } as const;
  const detail = {
    ...summary,
    activities: [
      {
        id: 'action_fixture',
        sessionId: summary.id,
        organizationId: orgId,
        type: 'action',
        approvalStatus: 'pending',
        createdAt,
        body: {
          action: {
            kind: 'tool',
            summary: 'Protected focus time',
            toolCall: {
              connection: 'sunsama',
              tool: 'sunsama_create_task',
              toolUseId: 'tool_fixture',
              input: { duration: 120 },
            },
            result: { content: 'Added 2 blocks to Thursday', isError: false },
          },
        },
      },
    ],
  } as const;
  const overview = {
    counts: { needsYou: 1, working: 2, finished: 4 },
    currentChat: null,
    sessions: { needsYou: [summary], working: [], finished: [] },
  } as const;

  await page.route('**/v1/me/athena**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/v1/me/athena') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(overview),
      });
      return;
    }
    if (request.method() === 'GET' && path === `/v1/me/athena/sessions/${summary.id}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
      return;
    }
    if (request.method() === 'POST' && path === '/v1/me/athena/activity/action_fixture/approve') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...detail.activities[0], sessionId: summary.id }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

test('personal Athena dock, workbench, context, redirects, and responsive themes', async ({
  page,
}, testInfo) => {
  const { orgId } = await signUpAndOnboard(page, 'personal-athena');
  await installAthenaFixture(page, orgId);

  await page.goto('/today');
  await page.keyboard.press('Meta+J');
  await expect(page.getByRole('dialog', { name: 'Athena' })).toBeVisible();
  await expect(page.getByText('1 needs you').first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Protect two hours for the launch review' }),
  ).toBeVisible();
  await expect(page.getByText('Only you can see this decision')).toBeVisible();
  await expect(page.getByText('Sunsama · Protected focus time')).toBeVisible();
  await expect(page.getByText('sunsama_create_task')).toBeHidden();
  await page.getByText('Technical details').click();
  await expect(page.getByText(/sunsama_create_task/)).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();

  await page.getByRole('button', { name: 'Close Athena' }).click();
  await page.getByRole('button', { name: 'Open Athena for today' }).click();
  await expect(page.getByRole('dialog', { name: 'Athena' })).toBeVisible();

  await page.goto(`/orgs/${orgId}/agents`);
  await expect(page).toHaveURL(`/athena?workspace=${orgId}`);
  await expect(page.getByRole('heading', { name: 'Your Athena work' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Athena' })).toHaveCount(0);

  for (const viewport of [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('navigation', { name: 'Athena work queue' })).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({
        path: testInfo.outputPath(`athena-${viewport.label}-${colorScheme}.png`),
        fullPage: true,
      });
    }
  }

  await page.setViewportSize({ width: 320, height: 844 });
  const viewportHealth = await page.locator('[data-athena-workspace]').evaluate((workspace) => {
    const visibleControls = [...workspace.querySelectorAll<HTMLElement>('button, textarea')].filter(
      (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      },
    );
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      undersized: visibleControls
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width < 40 || rect.height < 40;
        })
        .map((element) => element.textContent.trim() || element.getAttribute('aria-label')),
    };
  });
  expect(viewportHealth).toEqual({ overflow: 0, undersized: [] });

  const selectedWork = page.getByRole('button', {
    name: /Protect two hours for the launch review/,
  });
  await selectedWork.focus();
  const focusStyle = await selectedWork.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return `${style.outlineStyle} ${style.boxShadow}`;
  });
  expect(focusStyle).not.toBe('none none');

  const approvalColors = await page.getByRole('button', { name: 'Approve' }).evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  const foreground = relativeLuminance(approvalColors.foreground);
  const background = relativeLuminance(approvalColors.background);
  const approvalContrast =
    (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  expect(approvalContrast, JSON.stringify(approvalColors)).toBeGreaterThanOrEqual(4.5);
});
