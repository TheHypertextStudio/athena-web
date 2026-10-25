/** Geometric timeline and interaction checks with explicitly simulated agent activity. */
import type { Page } from '@playwright/test';
import axe, { type AxeStatic } from 'axe-core';
import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

/** Use a real task and an explicit activity fixture; no provider execution is simulated as real. */
async function openTimeline(page: Page): Promise<void> {
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
    performerName: 'Codex',
    clientName: 'Codex',
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
  const session = { id: 'fixture-session', kind: 'work', title: 'Codex session' };
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
      change: {
        field: 'description',
        label: 'Description',
        from: 'Original brief',
        to: 'Revised brief',
      },
    },
    { ...base, id: 'agent-result', origin, session, body: 'The brief is ready for review.' },
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
  await expect(page.getByRole('article', { name: 'Codex session' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
}

for (const width of [390, 1440, 1920]) {
  test(`simulated activity keeps connected geometry and operable disclosures at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openTimeline(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const changes = page.getByRole('button', { name: '1 change', exact: true });
    await changes.focus();
    await page.keyboard.press('Enter');
    await expect(changes).toHaveAttribute('aria-expanded', 'true');
    const description = page.getByRole('button', { name: 'Description revised' });
    await description.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Original brief')).toBeVisible();
    await expect(description).toBeFocused();
    expect(
      await changes
        .locator('svg')
        .evaluate((element) => getComputedStyle(element).transitionProperty),
    ).toBe('none');
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
    const changes = page.getByRole('button', { name: '1 change', exact: true });
    expect((await changes.boundingBox())?.height).toBeGreaterThanOrEqual(40);
    await changes.tap();
    const description = page.getByRole('button', { name: 'Description revised' });
    expect((await description.boundingBox())?.height).toBeGreaterThanOrEqual(40);
    await description.tap();
    await expect(page.getByText('Revised brief')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
});
