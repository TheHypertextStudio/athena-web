/** Geometric timeline and interaction checks with explicitly simulated agent activity. */
import type { Page } from '@playwright/test';
import axe, { type AxeStatic } from 'axe-core';
import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

/** Use a real task and an explicit activity fixture; no provider execution is simulated as real. */
async function openTimeline(page: Page, artwork = false): Promise<() => void> {
  const agentName = artwork ? 'Task automation' : 'Codex';
  const { orgId } = await signUpAndOnboard(page, 'BlueprintTimeline');
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: {
      title:
        'Request Urbanist Social Club campaign collateral from Bella and Thorne for the November community meetup',
      teamId: teams.items[0]?.id,
    },
  });
  const origin = {
    channel: 'mcp',
    surface: null,
    performerKind: 'agent',
    performerName: agentName,
    clientName: agentName,
    provider: null,
  };
  const base = {
    taskId: task.id,
    actorId: null,
    actorName: 'Willie',
    type: 'comment',
    category: 'comment',
    change: null,
    body: 'A human contribution.',
    subjectTaskId: null,
    subjectTaskTitle: null,
    createdAt: new Date().toISOString(),
    origin: null,
    session: null,
  };
  const session = { id: 'fixture-session', kind: 'work', title: `${agentName} session` };
  const agentIconUrl = artwork ? '/icons/icon-192.png' : undefined;
  const items = [
    { ...base, id: 'human-before' },
    {
      ...base,
      id: 'agent-edit',
      type: 'updated',
      category: 'task',
      body: null,
      origin,
      session,
      agentIconUrl,
      change: {
        field: 'description',
        label: 'Description',
        from: 'Original brief',
        to: 'Revised brief',
      },
    },
    {
      ...base,
      id: 'agent-result',
      origin,
      session,
      agentIconUrl,
      body: 'The brief is ready for review.',
    },
    { ...base, id: 'human-after', body: 'Reusable layouts can start.' },
  ];
  await page.route(`**/tasks/${task.id}/activity*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items }),
    }),
  );
  await page.goto(`${orgHref(orgId, 'tasks')}/${task.id}`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('article', { name: session.title })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  return () => {
    for (const item of items) {
      if ('agentIconUrl' in item) item.agentIconUrl = '/__fixture-missing-agent-artwork.png';
    }
  };
}

for (const width of [390, 1440, 1920]) {
  test(`simulated activity keeps connected geometry and operable disclosures at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openTimeline(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByRole('button', { name: '1 change', exact: true })).toHaveCount(0);
    const description = page.getByRole('button', { name: 'updated the description' });
    await description.focus();
    await page.keyboard.press('Enter');
    await expect(description).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Original brief')).toBeVisible();
    await expect(description).toBeFocused();
    expect(
      await description
        .locator('svg')
        .evaluate((element) => getComputedStyle(element).transitionProperty),
    ).toBe('none');
    expect(
      await page
        .locator('[data-entry-time]')
        .first()
        .evaluate((element) => getComputedStyle(element).fontFamily),
    ).not.toMatch(/mono/i);
    const geometry = await page.getByRole('list', { name: 'Task activity' }).evaluate((list) => {
      const items = Array.from(list.children) as HTMLElement[];
      return items.map((item) => {
        const node = item.querySelector('[data-timeline-node]')?.getBoundingClientRect();
        const line = getComputedStyle(item, '::before');
        return {
          center: node ? node.x + node.width / 2 : null,
          top: Number.parseFloat(line.top),
          height: Number.parseFloat(line.height),
        };
      });
    });
    expect(geometry).toHaveLength(3);
    expect(new Set(geometry.map((item) => item.center)).size).toBe(1);
    expect(geometry[0]?.top).toBe(16);
    expect(geometry.at(-1)?.height).toBeCloseTo(16, 0);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const title = document
            .querySelector('[aria-label="Task title"]')
            ?.getBoundingClientRect();
          const actions = document
            .querySelector('[aria-label="Entity actions"]')
            ?.getBoundingClientRect();
          if (!title || !actions) return true;
          return (
            title.left < actions.right &&
            title.right > actions.left &&
            title.top < actions.bottom &&
            title.bottom > actions.top
          );
        }),
      )
      .toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.addScriptTag({ content: axe.source });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const violations = await page.evaluate(async () => {
        const checker = (window as unknown as { axe: AxeStatic }).axe;
        return (
          await checker.run('[data-slot="timeline"]', {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
          })
        ).violations;
      });
      expect(violations).toEqual([]);
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
}

test.describe('touch activity controls', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 320, height: 844 } });
  test('keeps task change disclosures at least 40px high on a narrow touch pane', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTimeline(page);
    await page.setViewportSize({ width: 320, height: 844 });
    const description = page.getByRole('button', { name: 'updated the description' });
    expect((await description.boundingBox())?.height).toBeGreaterThanOrEqual(40);
    await description.tap();
    await expect(page.getByText('Revised brief').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
});

test('shows supplied agent artwork and retains a named glyph if the image fails', async ({
  page,
}) => {
  // Use the existing local app image as fixture artwork, not a claimed third-party brand logo.
  const failArtwork = await openTimeline(page, true);
  const contribution = page.getByRole('article', { name: 'Task automation session' });
  const image = contribution.locator('img');
  await expect(image).toBeVisible();
  expect(
    await image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  await page.route('**/__fixture-missing-agent-artwork.png', (route) => route.abort());
  failArtwork();
  await page.reload();
  await expect(page.getByRole('article', { name: 'Task automation session' })).toBeVisible();
  await expect(contribution.locator('img')).toHaveCount(0);
  await expect(contribution.getByRole('img', { name: 'Task automation' })).toBeVisible();
  await expect(
    contribution.getByRole('img', { name: 'Task automation', exact: true }).locator('svg'),
  ).toBeVisible();
});

test('opens recorded session activity and restores focus to its header control', async ({
  page,
}) => {
  await openTimeline(page);
  const opener = page.getByRole('button', { name: 'View session activity' });
  await opener.click();
  const inspector = page.getByRole('dialog', { name: 'Codex session' });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText('Original brief', { exact: true })).toBeVisible();
  await expect(inspector.getByText('The brief is ready for review.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inspector).toHaveCount(0);
  await expect(opener).toBeFocused();
});
