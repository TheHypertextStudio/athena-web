/** Browser proof that only detail pages with real content can own a scroll range. */
import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { visitBlueprintDailyPlanner } from '../helpers/work-template-blueprints';
import { createMobileAuditFixture } from '../helpers/mobile-audit-fixture';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 760, height: 900 },
  { width: 480, height: 844 },
  { width: 390, height: 844 },
] as const;

// The local audit uses freshly-created routes. A cached offline shell cannot prove their scroll
// ownership, so this browser test always exercises the live application response.
test.use({ serviceWorkers: 'block' });

/** Create enough real task rows for the Project document to exceed every test viewport. */
async function createLongProject(page: Page, orgId: string, teamId: string): Promise<string> {
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name: 'Scroll owner project', teamId },
  });
  await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      apiJson(page, `/v1/orgs/${orgId}/tasks`, {
        method: 'POST',
        body: { title: `Long Project task ${String(index + 1)}`, teamId, projectId: project.id },
      }),
    ),
  );
  return project.id;
}

/** Return a short page's scrolling ancestors, excluding the detail scroller itself. */
async function scrollingAncestors(detail: Locator): Promise<string[]> {
  return detail.evaluate((element) => {
    const owners: string[] = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
        owners.push(parent.dataset.detailPanelScroll === '' ? 'entity-detail' : parent.tagName);
      }
    }
    return owners;
  });
}

/** Return every element in the detail tree that exposes a real vertical scroll range. */
async function scrollOwners(detail: Locator): Promise<string[]> {
  return detail.evaluate((element) => {
    const candidates = [element, ...element.querySelectorAll<HTMLElement>('*')];
    return candidates.flatMap((candidate) => {
      const style = getComputedStyle(candidate);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        candidate.scrollHeight > candidate.clientHeight + 1
      ) {
        return candidate.dataset.detailPanelScroll === '' ? ['entity-detail'] : [candidate.tagName];
      }
      return [];
    });
  });
}

/** Set an offset and read it back after the browser applies its scrollability constraints. */
async function assignAndReadScrollTop(detail: Locator, value: number): Promise<number> {
  return detail.evaluate((element, nextValue) => {
    element.scrollTop = nextValue;
    return element.scrollTop;
  }, value);
}

test('a short Team page does not scroll while long Project work owns the only detail scrollbar', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signUpAndOnboard(page, 'EntityDetailScrollOwnership');
  const fixture = await createMobileAuditFixture(page);
  const longProjectId = await createLongProject(page, fixture.orgId, fixture.teamId);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(orgHref(fixture.orgId, `teams/${fixture.teamId}`), {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    const detail = page.locator('[data-detail-panel-scroll]:visible');
    await expect(detail).toBeVisible({ timeout: TIMEOUTS.pageReady });
    const dimensions = await detail.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
    expect(await assignAndReadScrollTop(detail, 40)).toBe(0);
    expect(await scrollingAncestors(detail)).toEqual([]);

    await page.goto(orgHref(fixture.orgId, `projects/${longProjectId}`), {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    await expect(page.getByRole('heading', { name: 'Scroll owner project' })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
    const longDetail = page.locator('[data-detail-panel-scroll]:visible');
    await expect(longDetail).toBeVisible();
    await expect.poll(() => scrollOwners(longDetail)).toEqual(['entity-detail']);
  }
});

/** Task titles and timer controls must occupy separate phone lanes, including after scrolling. */
test('phone task identity never overlaps its actions when the header collapses', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { orgId } = await signUpAndOnboard(page, 'PhoneTaskHeader');
  await visitBlueprintDailyPlanner(page);
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const team = teams.items[0];
  if (!team) throw new Error('The task header fixture needs a workspace team.');
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: {
      teamId: team.id,
      title: 'Check in with volunteer hosts before the community gathering',
      description: Array.from(
        { length: 35 },
        (_, index) => `Preparation ${index + 1}: confirm accessible arrival details.`,
      ).join('\n\n'),
    },
  });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(orgHref(orgId, `tasks/${task.id}`), { waitUntil: 'domcontentloaded' });
    const detail = page.locator('[data-detail-panel-scroll]:visible');
    await expect(detail).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await expect(page.getByRole('button', { name: 'Template actions', exact: true })).toBeVisible();
    for (const scrollTop of [0, 240]) {
      await detail.evaluate((element, top) => {
        element.scrollTop = top;
      }, scrollTop);
      await expect
        .poll(async () =>
          page.locator('.detail-title').evaluate((title) => {
            const actions = title.closest('.detail-primary')?.querySelector('.detail-actions');
            if (!actions) return false;
            const a = actions.getBoundingClientRect(),
              t = title.getBoundingClientRect();
            const overlap =
              Math.min(a.right, t.right) > Math.max(a.left, t.left) &&
              Math.min(a.bottom, t.bottom) > Math.max(a.top, t.top);
            return (
              !overlap &&
              a.left >= 0 &&
              a.right <= innerWidth &&
              t.left >= 0 &&
              t.right <= innerWidth
            );
          }),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page.locator('.detail-title').evaluate((title) => {
            const glyph = title.closest('.detail-primary')?.querySelector('.detail-glyph');
            return (
              Number.parseFloat(getComputedStyle(title).fontSize) <= 22 &&
              Boolean(
                glyph && title.getBoundingClientRect().top >= glyph.getBoundingClientRect().top - 1,
              )
            );
          }),
        )
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
    await detail.evaluate((element) => {
      element.scrollTop = 0;
    });
    await verifyTemplateActionKeyboard(page);
    for (const scheme of ['light', 'dark'] as const) {
      await setColorScheme(page, scheme);
      for (const [label, target] of [
        ['task-title', page.locator('.detail-title')],
        ['template-actions', page.getByRole('button', { name: 'Template actions', exact: true })],
      ] as const) {
        const colors = await textContrast(target);
        console.log(JSON.stringify({ evidence: 'text-contrast', width, scheme, label, ...colors }));
        expect(colors.ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

/** Open the contextual dialog with keys and restore focus to the same trigger on dismissal. */
async function verifyTemplateActionKeyboard(page: Page): Promise<void> {
  const templateActions = page.getByRole('button', { name: 'Template actions', exact: true });
  await expect(templateActions).toBeVisible();
  await templateActions.focus();
  await templateActions.press('Enter');
  await page.getByRole('menuitem', { name: 'Save as template', exact: true }).press('Enter');
  const capture = page.getByRole('dialog', { name: 'Save as template', exact: true });
  await expect(capture).toBeVisible();
  await capture.press('Escape');
  await expect(capture).not.toBeVisible();
  await expect(templateActions).toBeFocused();
}

/** Measure rendered text against the ancestor background stack using the browser's color parser. */
async function textContrast(target: Locator): Promise<{
  foreground: number[];
  background: number[];
  ratio: number;
}> {
  return target.evaluate((element) => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('The contrast check needs the browser canvas color parser.');
    const parse = (value: string): number[] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const composite = (front: number[], back: number[]): number[] => {
      const alpha = (front[3] ?? 255) / 255;
      return [0, 1, 2].map(
        (index) => (front[index] ?? 0) * alpha + (back[index] ?? 255) * (1 - alpha),
      );
    };
    const backgrounds: number[][] = [];
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      backgrounds.push(parse(getComputedStyle(ancestor).backgroundColor));
    }
    const background = backgrounds
      .reverse()
      .reduce((back, front) => composite(front, back), [255, 255, 255]);
    const foreground = composite(parse(getComputedStyle(element).color), background);
    const luminance = (color: number[]): number => {
      const linear = color.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
    };
    const lightness = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return {
      foreground,
      background,
      ratio: ((lightness[0] ?? 0) + 0.05) / ((lightness[1] ?? 0) + 0.05),
    };
  });
}
