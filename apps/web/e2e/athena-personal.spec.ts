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

/** Read an enabled control's foreground and nearest opaque background from the rendered page. */
async function readEnabledControlColors(
  page: Page,
  name: 'Approve' | 'Cancel work' | 'Reject',
): Promise<{ foreground: string; background: string }> {
  const control = page.getByRole('button', { name });
  await expect(control).toBeEnabled();
  return control.evaluate((element, controlName) => {
    const toSrgb = (color: string): string => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not normalize a computed color');
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
      return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
    };
    const button = element as HTMLButtonElement;
    const style = window.getComputedStyle(button);
    let background = style.backgroundColor;
    let effectiveOpacity = Number(style.opacity);
    let ancestor = button.parentElement;
    while ((background === 'rgba(0, 0, 0, 0)' || background === 'transparent') && ancestor) {
      const ancestorStyle = window.getComputedStyle(ancestor);
      background = ancestorStyle.backgroundColor;
      effectiveOpacity *= Number(ancestorStyle.opacity);
      ancestor = ancestor.parentElement;
    }

    if (button.disabled || effectiveOpacity !== 1) {
      throw new Error(`${controlName} must be visibly enabled before review captures`);
    }
    return {
      foreground: toSrgb(style.color),
      background: toSrgb(background),
    };
  }, name);
}

/** Assert WCAG AA contrast for ordinary-size text in one enabled action. */
async function expectControlContrast(
  page: Page,
  name: 'Approve' | 'Cancel work' | 'Reject',
): Promise<void> {
  let colors = await readEnabledControlColors(page, name);
  const readContrast = async (): Promise<number> => {
    colors = await readEnabledControlColors(page, name);
    const foreground = relativeLuminance(colors.foreground);
    const background = relativeLuminance(colors.background);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  };
  await expect
    .poll(readContrast, { message: `${name} color transition did not settle` })
    .toBeGreaterThanOrEqual(4.5);
  const contrast = await readContrast();
  expect(contrast, `${name}: ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(4.5);
}

/** Install the personal API fixture until the generated client lane lands in this worktree. */
async function installAthenaFixture(
  page: Page,
  orgId: string,
): Promise<{
  readonly releaseApproval: () => void;
  readonly readApprovalPath: () => string | null;
}> {
  let releaseApproval = (): void => undefined;
  let approvalPath: string | null = null;
  let approved = false;
  const approvalGate = new Promise<void>((resolve) => {
    releaseApproval = resolve;
  });
  const summary = {
    id: 'athena_fixture_session',
    kind: 'job',
    status: 'awaiting_approval',
    queueState: 'needs_you',
    objective: 'Protect two hours for the launch review',
    context: {
      workspaceId: orgId,
      source: { type: 'project', id: 'project_fixture', label: 'Athena launch' },
    },
    workspace: { id: orgId, name: 'Personal workspace' },
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
        approvalStatus: 'proposed',
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
  const settledDetail = {
    ...detail,
    status: 'completed',
    queueState: 'finished',
    endedAt: '2026-07-15T16:00:00.000Z',
    activities: [{ ...detail.activities[0], approvalStatus: 'applied' }],
  } as const;

  await page.route('**/v1/me/athena**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/v1/me/athena/pulse') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ needsYou: approved ? 0 : 1, working: 0 }),
      });
      return;
    }
    if (request.method() === 'GET' && path === '/v1/me/athena') {
      const settledSummary = {
        ...summary,
        status: settledDetail.status,
        queueState: settledDetail.queueState,
        endedAt: settledDetail.endedAt,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          approved
            ? {
                counts: { needsYou: 0, working: 0, finished: 1 },
                currentChat: null,
                sessions: { needsYou: [], working: [], finished: [settledSummary] },
              }
            : {
                counts: { needsYou: 1, working: 0, finished: 0 },
                currentChat: null,
                sessions: { needsYou: [summary], working: [], finished: [] },
              },
        ),
      });
      return;
    }
    if (request.method() === 'GET' && path === `/v1/me/athena/sessions/${summary.id}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(approved ? settledDetail : detail),
      });
      return;
    }
    if (
      request.method() === 'POST' &&
      path === `/v1/me/athena/sessions/${summary.id}/activity/action_fixture/approve`
    ) {
      approvalPath = path;
      await approvalGate;
      approved = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settledDetail.activities[0]),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  return { releaseApproval, readApprovalPath: () => approvalPath };
}

test('personal Athena dock, workbench, context, redirects, and responsive themes', async ({
  page,
}, testInfo) => {
  const { orgId } = await signUpAndOnboard(page, 'personal-athena');
  const { releaseApproval, readApprovalPath } = await installAthenaFixture(page, orgId);

  await page.goto('/today');
  await expect(page.getByRole('button', { name: 'Open Athena' })).toContainText('1 needs you');
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
      await expectControlContrast(page, 'Cancel work');
      await expectControlContrast(page, 'Approve');
      await expectControlContrast(page, 'Reject');
      await page.screenshot({
        path: testInfo.outputPath(`athena-${viewport.label}-${colorScheme}.png`),
        fullPage: true,
      });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByText('Technical details').click();
  await expect(page.getByText(/sunsama_create_task/)).toBeVisible();
  await page.getByRole('form', { name: 'Steer Athena' }).scrollIntoViewIfNeeded();
  await expect(page.getByText('Added 2 blocks to Thursday', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Add context or answer' })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('athena-mobile-below-fold.png'),
    fullPage: false,
  });

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
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(selectedWork).toBeFocused();
  const focusStyle = await selectedWork.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return `${style.outlineStyle} ${style.boxShadow}`;
  });
  expect(focusStyle).not.toBe('none none');

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect
    .poll(readApprovalPath)
    .toBe(`/v1/me/athena/sessions/athena_fixture_session/activity/action_fixture/approve`);
  for (const name of ['Cancel work', 'Approve', 'Reject'] as const) {
    const control = page.getByRole('button', { name });
    await expect(control).toBeDisabled();
    await expect(control).toHaveCSS('opacity', '0.5');
  }
  releaseApproval();
  await expect(page.getByRole('heading', { name: 'Work finished' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  const workQueue = page.getByRole('navigation', { name: 'Athena work queue' });
  await expect(workQueue.getByRole('heading', { name: 'Needs you' }).locator('..')).toContainText(
    '0',
  );
  await expect(workQueue.getByRole('heading', { name: 'Finished' }).locator('..')).toContainText(
    '1',
  );
});
